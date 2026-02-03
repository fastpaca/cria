import { useCallback, useEffect, useRef, useState } from "react";

export interface ResizableOptions {
  initialWidth?: number | null;
  minWidth: number;
  maxWidth?: number;
  maxWidthPercent?: number;
}

export const useResizable = <T extends HTMLElement>({
  initialWidth = null,
  minWidth,
  maxWidth,
  maxWidthPercent,
}: ResizableOptions) => {
  const [width, setWidth] = useState<number | null>(initialWidth);
  const [isDragging, setIsDragging] = useState(false);
  const ref = useRef<T | null>(null);

  useEffect(() => {
    if (!isDragging) {
      return;
    }

    const handleMouseMove = (e: MouseEvent) => {
      if (!ref.current) {
        return;
      }
      const rect = ref.current.getBoundingClientRect();
      const resolvedMax =
        maxWidth ??
        (maxWidthPercent ? rect.width * maxWidthPercent : rect.width);
      const newWidth = Math.min(
        Math.max(e.clientX - rect.left, minWidth),
        resolvedMax
      );
      setWidth(newWidth);
    };

    const handleMouseUp = () => {
      setIsDragging(false);
      document.body.classList.remove("resizing");
    };

    document.addEventListener("mousemove", handleMouseMove);
    document.addEventListener("mouseup", handleMouseUp);

    return () => {
      document.removeEventListener("mousemove", handleMouseMove);
      document.removeEventListener("mouseup", handleMouseUp);
    };
  }, [isDragging, minWidth, maxWidth, maxWidthPercent]);

  const startDragging = useCallback(() => {
    setIsDragging(true);
    document.body.classList.add("resizing");
  }, []);

  return { width, isDragging, startDragging, ref };
};
