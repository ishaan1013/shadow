#!/bin/bash

# Setup DevMapper Storage for Kata Containers with Firecracker
# This script configures the devmapper snapshotter required for Firecracker VMs

set -euo pipefail

# Colors for output
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m'

log() {
    echo -e "${GREEN}[DEVMAPPER]${NC} $1"
}

warn() {
    echo -e "${YELLOW}[DEVMAPPER]${NC} $1"
}

error() {
    echo -e "${RED}[DEVMAPPER]${NC} $1"
    exit 1
}

# Check if running as root
if [ "$EUID" -ne 0 ]; then
    error "This script must be run as root"
fi

log "Setting up DevMapper snapshotter for Kata Containers + Firecracker..."

# Create storage directory
STORAGE_DIR="/var/lib/kata-devmapper"
mkdir -p "$STORAGE_DIR"
cd "$STORAGE_DIR"

# Create sparse files for storage if they don't exist
if [ ! -f "data.img" ]; then
    log "Creating 100G sparse file for container images..."
    dd if=/dev/zero of=data.img bs=1 count=0 seek=100G
fi

if [ ! -f "metadata.img" ]; then
    log "Creating 10G sparse file for metadata..."
    dd if=/dev/zero of=metadata.img bs=1 count=0 seek=10G
fi

# Setup loop devices
DATA_LOOP=$(losetup -f --show data.img)
METADATA_LOOP=$(losetup -f --show metadata.img)

log "Data loop device: $DATA_LOOP"
log "Metadata loop device: $METADATA_LOOP"

# Create thin pool if it doesn't exist
POOL_NAME="kata-pool"
if ! dmsetup info "$POOL_NAME" &>/dev/null; then
    log "Creating device mapper thin pool..."
    
    # Calculate sector sizes (512 byte sectors)
    DATA_SIZE_SECTORS=$(blockdev --getsz "$DATA_LOOP")
    METADATA_SIZE_SECTORS=$(blockdev --getsz "$METADATA_LOOP")
    
    # Create thin pool
    dmsetup create "$POOL_NAME" --table "0 $DATA_SIZE_SECTORS thin-pool $METADATA_LOOP $DATA_LOOP 128 32768"
    
    log "Created thin pool: $POOL_NAME"
else
    log "Thin pool $POOL_NAME already exists"
fi

# Configure containerd to use devmapper
CONTAINERD_CONFIG="/etc/containerd/config.toml"
log "Configuring containerd to use devmapper snapshotter..."

# Backup original config
if [ ! -f "${CONTAINERD_CONFIG}.backup" ]; then
    cp "$CONTAINERD_CONFIG" "${CONTAINERD_CONFIG}.backup"
    log "Backed up original containerd config"
fi

# Create new containerd config with devmapper
cat > "$CONTAINERD_CONFIG" << 'EOF'
version = 2

[plugins]
  [plugins."io.containerd.grpc.v1.cri"]
    [plugins."io.containerd.grpc.v1.cri".containerd]
      default_runtime_name = "runc"
      snapshotter = "devmapper"
      
      [plugins."io.containerd.grpc.v1.cri".containerd.default_runtime]
        runtime_type = "io.containerd.runc.v2"
        
      [plugins."io.containerd.grpc.v1.cri".containerd.runtimes]
        [plugins."io.containerd.grpc.v1.cri".containerd.runtimes.runc]
          runtime_type = "io.containerd.runc.v2"
          
        [plugins."io.containerd.grpc.v1.cri".containerd.runtimes.kata-fc]
          runtime_type = "io.containerd.kata-fc.v2"
          
        [plugins."io.containerd.grpc.v1.cri".containerd.runtimes.kata-qemu]
          runtime_type = "io.containerd.kata-qemu.v2"

  [plugins."io.containerd.snapshotter.v1.devmapper"]
    root_path = "/var/lib/containerd/io.containerd.snapshotter.v1.devmapper"
    pool_name = "kata-pool"
    base_image_size = "10GB"
    async_remove = false
    discard_blocks = false
    fs_type = "ext4"
    fs_options = ""
EOF

log "Updated containerd configuration"

# Restart containerd
log "Restarting containerd service..."
systemctl restart containerd

# Wait for containerd to be ready
sleep 5

# Verify configuration
log "Verifying devmapper snapshotter..."
if containerd config dump | grep -q "snapshotter.*devmapper"; then
    log "✅ DevMapper snapshotter configured successfully"
else
    error "❌ DevMapper snapshotter configuration failed"
fi

log "DevMapper setup completed successfully!"
log ""
log "Setup Summary:"
log "- Data file: $STORAGE_DIR/data.img (100G)"
log "- Metadata file: $STORAGE_DIR/metadata.img (10G)" 
log "- Thin pool: $POOL_NAME"
log "- Containerd snapshotter: devmapper"
log ""
log "Note: On reboot, you may need to recreate the thin pool."
log "Run this script again if needed."