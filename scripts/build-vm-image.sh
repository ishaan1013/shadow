#!/bin/bash

# Shadow Firecracker VM Image Builder
# Creates Ubuntu 22.04 LTS root filesystem with pre-installed development tools

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"
VM_IMAGE_DIR="$PROJECT_ROOT/vm-image"
OUTPUT_DIR="$VM_IMAGE_DIR/output"
ROOTFS_DIR="$VM_IMAGE_DIR/rootfs"

# Configuration
UBUNTU_VERSION="22.04"
IMAGE_SIZE="2G"
KERNEL_VERSION="5.15.0-91-generic"
NODE_VERSION="20"
PYTHON_VERSION="3.11"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

log() {
    echo -e "${GREEN}[VM-BUILD]${NC} $1"
}

warn() {
    echo -e "${YELLOW}[VM-BUILD]${NC} $1"
}

error() {
    echo -e "${RED}[VM-BUILD]${NC} $1"
    exit 1
}

# Check prerequisites
check_prerequisites() {
    log "Checking prerequisites..."
    
    if ! command -v debootstrap &> /dev/null; then
        error "debootstrap is required but not installed. Run: sudo apt-get install debootstrap"
    fi
    
    if ! command -v chroot &> /dev/null; then
        error "chroot is required but not installed"
    fi
    
    if [[ $EUID -ne 0 ]]; then
        error "This script must be run as root for chroot operations"
    fi
    
    log "Prerequisites check passed"
}

# Create directory structure
setup_directories() {
    log "Setting up directory structure..."
    
    mkdir -p "$OUTPUT_DIR"
    mkdir -p "$ROOTFS_DIR"
    
    log "Directories created"
}

# Create Ubuntu base filesystem
create_base_filesystem() {
    log "Creating Ubuntu $UBUNTU_VERSION base filesystem..."
    
    if [[ -d "$ROOTFS_DIR/bin" ]]; then
        warn "Rootfs already exists, skipping debootstrap"
        return
    fi
    
    debootstrap --arch=amd64 jammy "$ROOTFS_DIR" http://archive.ubuntu.com/ubuntu/
    
    log "Base filesystem created"
}

# Configure the chroot environment
configure_system() {
    log "Configuring system in chroot..."
    
    # Mount necessary filesystems
    mount -t proc /proc "$ROOTFS_DIR/proc"
    mount -t sysfs /sys "$ROOTFS_DIR/sys"
    mount -o bind /dev "$ROOTFS_DIR/dev"
    mount -o bind /dev/pts "$ROOTFS_DIR/dev/pts"
    
    # Configure DNS
    cp /etc/resolv.conf "$ROOTFS_DIR/etc/resolv.conf"
    
    # Configure sources.list
    cat > "$ROOTFS_DIR/etc/apt/sources.list" << EOF
deb http://archive.ubuntu.com/ubuntu jammy main restricted universe multiverse
deb http://archive.ubuntu.com/ubuntu jammy-updates main restricted universe multiverse
deb http://archive.ubuntu.com/ubuntu jammy-security main restricted universe multiverse
EOF
    
    log "System configuration completed"
}

# Install essential packages
install_packages() {
    log "Installing essential packages..."
    
    chroot "$ROOTFS_DIR" /bin/bash -c "
        export DEBIAN_FRONTEND=noninteractive
        apt-get update
        apt-get install -y \
            ca-certificates \
            curl \
            wget \
            git \
            build-essential \
            python3 \
            python3-pip \
            python3-dev \
            ripgrep \
            tmux \
            vim \
            nano \
            htop \
            systemd \
            systemd-sysv \
            openssh-server \
            sudo \
            locales \
            tzdata
    "
    
    log "Essential packages installed"
}

# Install Node.js
install_nodejs() {
    log "Installing Node.js $NODE_VERSION..."
    
    chroot "$ROOTFS_DIR" /bin/bash -c "
        curl -fsSL https://deb.nodesource.com/setup_${NODE_VERSION}.x | bash -
        apt-get install -y nodejs
        npm install -g npm@latest
    "
    
    log "Node.js installed"
}

# Install Python LSP and TypeScript LSP
install_lsp_servers() {
    log "Installing LSP servers..."
    
    chroot "$ROOTFS_DIR" /bin/bash -c "
        # Install Python LSP server
        pip3 install python-lsp-server[all]
        
        # Install TypeScript LSP server
        npm install -g typescript-language-server typescript
        
        # Install additional language tools
        npm install -g eslint prettier
        pip3 install black isort flake8 mypy
    "
    
    log "LSP servers installed"
}

# Build and install Shadow sidecar
build_sidecar() {
    log "Building Shadow sidecar binary..."
    
    # Build sidecar in host environment first
    cd "$PROJECT_ROOT/apps/sidecar"
    npm run build
    
    # Create sidecar directory in VM
    mkdir -p "$ROOTFS_DIR/opt/shadow"
    
    # Copy sidecar build output
    cp -r dist/* "$ROOTFS_DIR/opt/shadow/"
    
    # Create production package.json WITHOUT workspace dependencies
    log "Creating production package.json without workspace dependencies..."
    node -e "
    const fs = require('fs');
    const path = require('path');
    const pkg = JSON.parse(fs.readFileSync('package.json', 'utf8'));
    
    // Filter out workspace dependencies (@repo/*)
    const prodDeps = {};
    if (pkg.dependencies) {
        for (const [name, version] of Object.entries(pkg.dependencies)) {
            if (!name.startsWith('@repo/')) {
                prodDeps[name] = version;
            }
        }
    }
    
    // Create production package.json
    const prodPkg = {
        name: pkg.name,
        version: pkg.version,
        description: pkg.description,
        main: pkg.main,
        scripts: {
            start: pkg.scripts.start
        },
        dependencies: prodDeps,
        engines: pkg.engines
    };
    
    const outputPath = '$ROOTFS_DIR/opt/shadow/package.json';
    fs.writeFileSync(outputPath, JSON.stringify(prodPkg, null, 2));
    console.log('Production package.json created with dependencies:', Object.keys(prodDeps));
    "
    
    # Install only external production dependencies in chroot
    chroot "$ROOTFS_DIR" /bin/bash -c "
        cd /opt/shadow
        echo 'Installing production dependencies...'
        npm install --production --no-optional --no-audit
        echo 'Production dependencies installed successfully'
    "
    
    log "Shadow sidecar built and installed"
}

# Create systemd service for sidecar
create_sidecar_service() {
    log "Creating Shadow sidecar systemd service..."
    
    cat > "$ROOTFS_DIR/etc/systemd/system/shadow-sidecar.service" << EOF
[Unit]
Description=Shadow Sidecar Service
After=network.target

[Service]
Type=simple
User=root
WorkingDirectory=/opt/shadow
ExecStart=/usr/bin/node server.js
Restart=always
RestartSec=10
Environment=NODE_ENV=production
Environment=PORT=8080

[Install]
WantedBy=multi-user.target
EOF
    
    # Enable the service
    chroot "$ROOTFS_DIR" /bin/bash -c "
        systemctl enable shadow-sidecar.service
    "
    
    log "Sidecar service created and enabled"
}

# Configure system settings
configure_vm_settings() {
    log "Configuring VM-specific settings..."
    
    # Configure locale
    chroot "$ROOTFS_DIR" /bin/bash -c "
        locale-gen en_US.UTF-8
        update-locale LANG=en_US.UTF-8
    "
    
    # Configure timezone
    chroot "$ROOTFS_DIR" /bin/bash -c "
        ln -sf /usr/share/zoneinfo/UTC /etc/localtime
        dpkg-reconfigure -f noninteractive tzdata
    "
    
    # Create shadow user
    chroot "$ROOTFS_DIR" /bin/bash -c "
        useradd -m -s /bin/bash -G sudo shadow
        echo 'shadow:shadow' | chpasswd
        echo 'shadow ALL=(ALL) NOPASSWD:ALL' >> /etc/sudoers
    "
    
    # Configure SSH
    chroot "$ROOTFS_DIR" /bin/bash -c "
        systemctl enable ssh
        sed -i 's/#PermitRootLogin prohibit-password/PermitRootLogin yes/' /etc/ssh/sshd_config
        sed -i 's/#PasswordAuthentication yes/PasswordAuthentication yes/' /etc/ssh/sshd_config
    "
    
    # Set root password
    chroot "$ROOTFS_DIR" /bin/bash -c "
        echo 'root:shadow' | chpasswd
    "
    
    log "VM settings configured"
}

# Create filesystem image
create_filesystem_image() {
    log "Creating filesystem image..."
    
    # Unmount chroot filesystems
    umount -l "$ROOTFS_DIR/proc" || true
    umount -l "$ROOTFS_DIR/sys" || true
    umount -l "$ROOTFS_DIR/dev/pts" || true
    umount -l "$ROOTFS_DIR/dev" || true
    
    # Create raw image file
    IMAGE_FILE="$OUTPUT_DIR/shadow-rootfs.ext4"
    dd if=/dev/zero of="$IMAGE_FILE" bs=1M count=2048
    
    # Format as ext4
    mkfs.ext4 -F "$IMAGE_FILE"
    
    # Mount and copy rootfs
    MOUNT_DIR=$(mktemp -d)
    mount -o loop "$IMAGE_FILE" "$MOUNT_DIR"
    
    log "Copying rootfs to image..."
    cp -a "$ROOTFS_DIR/"* "$MOUNT_DIR/"
    
    umount "$MOUNT_DIR"
    rmdir "$MOUNT_DIR"
    
    log "Filesystem image created: $IMAGE_FILE"
}

# Download Firecracker kernel
download_kernel() {
    log "Downloading Firecracker-compatible kernel..."
    
    KERNEL_FILE="$OUTPUT_DIR/vmlinux"
    
    if [[ -f "$KERNEL_FILE" ]]; then
        warn "Kernel already exists, skipping download"
        return
    fi
    
    # Download pre-built Firecracker kernel
    wget -O "$KERNEL_FILE" \
        "https://s3.amazonaws.com/spec.ccfc.min/img/quickstart_guide/x86_64/kernels/vmlinux.bin"
    
    log "Kernel downloaded: $KERNEL_FILE"
}

# Compress images
compress_images() {
    log "Compressing VM images..."
    
    cd "$OUTPUT_DIR"
    
    # Compress rootfs
    if [[ ! -f "shadow-rootfs.ext4.gz" ]]; then
        gzip -k shadow-rootfs.ext4
        log "Rootfs compressed: shadow-rootfs.ext4.gz"
    fi
    
    # Compress kernel
    if [[ ! -f "vmlinux.gz" ]]; then
        gzip -k vmlinux
        log "Kernel compressed: vmlinux.gz"
    fi
}

# Generate manifest
generate_manifest() {
    log "Generating VM image manifest..."
    
    cat > "$OUTPUT_DIR/manifest.json" << EOF
{
  "version": "1.0.0",
  "build_date": "$(date -u +%Y-%m-%dT%H:%M:%SZ)",
  "ubuntu_version": "$UBUNTU_VERSION",
  "kernel_version": "$KERNEL_VERSION",
  "node_version": "$NODE_VERSION",
  "python_version": "$PYTHON_VERSION",
  "files": {
    "rootfs": "shadow-rootfs.ext4.gz",
    "kernel": "vmlinux.gz",
    "rootfs_uncompressed": "shadow-rootfs.ext4",
    "kernel_uncompressed": "vmlinux"
  },
  "checksums": {
    "rootfs": "$(sha256sum shadow-rootfs.ext4.gz | cut -d' ' -f1)",
    "kernel": "$(sha256sum vmlinux.gz | cut -d' ' -f1)"
  }
}
EOF
    
    log "Manifest generated: $OUTPUT_DIR/manifest.json"
}

# Create Docker image containing VM files
create_docker_image() {
    log "Creating Docker image with VM files..."
    
    # Create Dockerfile for VM image
    cat > "$OUTPUT_DIR/Dockerfile" << EOF
FROM ubuntu:22.04

# Install Firecracker and runtime dependencies
RUN apt-get update && apt-get install -y \\
    curl \\
    wget \\
    iptables \\
    && rm -rf /var/lib/apt/lists/*

# Download and install Firecracker
RUN wget https://github.com/firecracker-microvm/firecracker/releases/download/v1.4.1/firecracker-v1.4.1-x86_64.tgz \\
    && tar -xzf firecracker-v1.4.1-x86_64.tgz \\
    && cp release-v1.4.1-x86_64/firecracker-v1.4.1-x86_64 /usr/local/bin/firecracker \\
    && cp release-v1.4.1-x86_64/jailer-v1.4.1-x86_64 /usr/local/bin/jailer \\
    && chmod +x /usr/local/bin/firecracker /usr/local/bin/jailer \\
    && rm -rf firecracker-v1.4.1-x86_64.tgz release-v1.4.1-x86_64

# Create directories for VM files
RUN mkdir -p /var/lib/firecracker/images /var/lib/firecracker/kernels

# Copy VM images
COPY shadow-rootfs.ext4 /var/lib/firecracker/images/
COPY vmlinux /var/lib/firecracker/kernels/
COPY manifest.json /var/lib/firecracker/

# Copy Firecracker configuration template
COPY firecracker-config-template.json /var/lib/firecracker/

# Copy startup script
COPY start-firecracker.sh /usr/local/bin/
RUN chmod +x /usr/local/bin/start-firecracker.sh

# Expose sidecar port (will be forwarded from VM)
EXPOSE 8080

# Run Firecracker VM
CMD ["/usr/local/bin/start-firecracker.sh"]
EOF

    # Create Firecracker configuration template
    cat > "$OUTPUT_DIR/firecracker-config-template.json" << EOF
{
  "boot-source": {
    "kernel_image_path": "/var/lib/firecracker/kernels/vmlinux",
    "boot_args": "console=ttyS0 reboot=k panic=1 pci=off init=/sbin/init"
  },
  "drives": [
    {
      "drive_id": "rootfs",
      "path_on_host": "/var/lib/firecracker/images/shadow-rootfs.ext4",
      "is_root_device": true,
      "is_read_only": false
    }
  ],
  "machine-config": {
    "vcpu_count": 1,
    "mem_size_mib": 1024,
    "ht_enabled": false,
    "track_dirty_pages": false
  },
  "network-interfaces": [
    {
      "iface_id": "eth0",
      "guest_mac": "AA:FC:00:00:00:01",
      "host_dev_name": "tap0"
    }
  ],
  "logger": {
    "log_path": "/tmp/firecracker.log",
    "level": "Info",
    "show_level": true,
    "show_log_origin": true
  }
}
EOF

    # Create startup script
    cat > "$OUTPUT_DIR/start-firecracker.sh" << 'EOF'
#!/bin/bash

set -euo pipefail

TASK_ID="${TASK_ID:-default}"
VM_CONFIG="/tmp/firecracker-config.json"

# Create unique configuration for this task
sed "s/tap0/tap${TASK_ID}/g" /var/lib/firecracker/firecracker-config-template.json > "$VM_CONFIG"

# Set up networking (if running privileged)
if [[ -w /dev/kvm ]]; then
    # Create TAP interface
    ip tuntap add dev "tap${TASK_ID}" mode tap || true
    ip link set dev "tap${TASK_ID}" up || true
    ip addr add 172.16.0.1/24 dev "tap${TASK_ID}" || true
fi

echo "Starting Firecracker VM for task: $TASK_ID"
echo "VM config: $VM_CONFIG"

# Start Firecracker VM
exec /usr/local/bin/firecracker --config-file "$VM_CONFIG"
EOF

    # Build Docker image
    cd "$OUTPUT_DIR"
    docker build -t shadow-vm:latest .
    
    log "Docker image created: shadow-vm:latest"
    log "Image contains VM files and Firecracker runtime"
}

# Main execution
main() {
    log "Starting Shadow VM image build..."
    
    check_prerequisites
    setup_directories
    create_base_filesystem
    configure_system
    install_packages
    install_nodejs
    install_lsp_servers
    build_sidecar
    create_sidecar_service
    configure_vm_settings
    create_filesystem_image
    download_kernel
    compress_images
    generate_manifest
    create_docker_image
    
    log "VM image build completed successfully!"
    log "Output directory: $OUTPUT_DIR"
    log "Rootfs: shadow-rootfs.ext4.gz ($(du -h $OUTPUT_DIR/shadow-rootfs.ext4.gz | cut -f1))"
    log "Kernel: vmlinux.gz ($(du -h $OUTPUT_DIR/vmlinux.gz | cut -f1))"
    log "Docker image: shadow-vm:latest"
}

# Handle cleanup on exit
cleanup() {
    log "Cleaning up..."
    umount -l "$ROOTFS_DIR/proc" 2>/dev/null || true
    umount -l "$ROOTFS_DIR/sys" 2>/dev/null || true
    umount -l "$ROOTFS_DIR/dev/pts" 2>/dev/null || true
    umount -l "$ROOTFS_DIR/dev" 2>/dev/null || true
}

trap cleanup EXIT

# Run main function
main "$@"