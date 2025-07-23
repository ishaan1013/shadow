import {
  AlertCircle,
  Archive,
  CheckCircle2,
  CircleDashed,
  PlayCircle,
  StopCircle,
  XCircleIcon,
} from "lucide-react";

export const statusOrder = {
  COMPLETED: 0,
  RUNNING: 1,
  INITIALIZING: 2,
  STOPPED: 3,
  FAILED: 4,
  ARCHIVED: 5,
  CANCELLED: 6,
};

// Status icons and colors
export const statusColorsConfig = {
  COMPLETED: {
    icon: CheckCircle2,
    className: "text-green-400",
    bg: "bg-green-400",
  },
  STOPPED: {
    icon: StopCircle,
    className: "text-orange-400",
    bg: "bg-orange-400",
  },
  RUNNING: { icon: PlayCircle, className: "text-blue-400", bg: "bg-blue-400" },
  INITIALIZING: {
    icon: CircleDashed,
    className: "text-yellow-500",
    bg: "bg-yellow-500",
  },
  FAILED: { icon: AlertCircle, className: "text-red-400", bg: "bg-red-500" },
  ARCHIVED: {
    icon: Archive,
    className: "text-neutral-500",
    bg: "bg-neutral-500",
  },
  CANCELLED: { icon: XCircleIcon, className: "text-red-400", bg: "bg-red-500" },
};
