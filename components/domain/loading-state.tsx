import { Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";

interface LoadingStateProps {
  message?: string;
  className?: string;
}

export function LoadingState({ message = "Loading...", className }: LoadingStateProps) {
  return (
    <div className={cn("flex flex-col items-center justify-center p-8 gap-2 text-muted-foreground", className)}>
      <Loader2 className="size-6 animate-spin" />
      <p className="text-sm">{message}</p>
    </div>
  );
}
