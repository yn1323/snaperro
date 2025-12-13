import { Box } from "@chakra-ui/react";
import { useCallback, useEffect, useRef, useState } from "react";

interface ResizeHandleProps {
  onResize: (delta: number) => void;
}

/**
 * Draggable resize handle for pane resizing
 */
export function ResizeHandle({ onResize }: ResizeHandleProps) {
  const [isDragging, setIsDragging] = useState(false);
  const startXRef = useRef(0);

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    setIsDragging(true);
    startXRef.current = e.clientX;
  }, []);

  useEffect(() => {
    if (!isDragging) return;

    const handleMouseMove = (e: MouseEvent) => {
      const delta = e.clientX - startXRef.current;
      if (delta !== 0) {
        onResize(delta);
        startXRef.current = e.clientX;
      }
    };

    const handleMouseUp = () => {
      setIsDragging(false);
    };

    document.addEventListener("mousemove", handleMouseMove);
    document.addEventListener("mouseup", handleMouseUp);

    return () => {
      document.removeEventListener("mousemove", handleMouseMove);
      document.removeEventListener("mouseup", handleMouseUp);
    };
  }, [isDragging, onResize]);

  return (
    <Box
      w="4px"
      cursor="col-resize"
      bg={isDragging ? "accent.500" : "transparent"}
      _hover={{ bg: "accent.300" }}
      transition="background 0.15s ease"
      flexShrink={0}
      onMouseDown={handleMouseDown}
    />
  );
}
