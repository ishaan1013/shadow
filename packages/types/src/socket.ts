export interface FileSystemEvent {
  id: string;
  taskId: string;
  type: 'file-created' | 'file-modified' | 'file-deleted' | 'directory-created' | 'directory-deleted';
  path: string;
  timestamp: number;
  source: 'local' | 'remote';
  isDirectory: boolean;
}

export interface SidecarToServerEvents {
  'join-task': (data: { taskId: string, podId?: string }) => void;
  'fs-change': (event: FileSystemEvent) => void;
  'heartbeat': () => void;
}

export interface ServerToSidecarEvents {
  'task-joined': (data: { taskId: string, success: boolean }) => void;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  'config-update': (config: any) => void;
} 