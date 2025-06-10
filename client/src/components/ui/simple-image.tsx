import React from "react";
import { cn } from "@/lib/utils";

interface SimpleImageProps {
  src: string;
  alt: string;
  className?: string;
  onClick?: () => void;
}

export default function SimpleImage({ src, alt, className, onClick }: SimpleImageProps) {
  // Check if we need fallback image
  const needsFallback = !src || src.trim() === '' || src === 'No Image' || src === 'null' || src === 'undefined';
  
  if (needsFallback) {
    return (
      <img
        src="/uploads/superhero-fallback.svg"
        alt="Image Coming Soon"
        className={cn("w-full h-full object-cover rounded-lg", className)}
        onClick={onClick}
        onError={(e) => {
          // Embedded SVG fallback
          const target = e.target as HTMLImageElement;
          target.src = 'data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iMjAwIiBoZWlnaHQ9IjMwMCIgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIj48ZGVmcz48bGluZWFyR3JhZGllbnQgaWQ9ImJnR3JhZGllbnQiIHgxPSIwJSIgeTE9IjAlIiB4Mj0iMTAwJSIgeTI9IjEwMCUiPjxzdG9wIG9mZnNldD0iMCUiIHN0eWxlPSJzdG9wLWNvbG9yOiMxZjI5Mzc7c3RvcC1vcGFjaXR5OjEiIC8+PHN0b3Agb2Zmc2V0PSIxMDAlIiBzdHlsZT0ic3RvcC1jb2xvcjojMTExODI3O3N0b3Atb3BhY2l0eToxIiAvPjwvbGluZWFyR3JhZGllbnQ+PC9kZWZzPjxyZWN0IHdpZHRoPSIxMDAlIiBoZWlnaHQ9IjEwMCUiIGZpbGw9InVybCgjYmdHcmFkaWVudCkiIHN0cm9rZT0iIzM3NDE1MSIgc3Ryb2tlLXdpZHRoPSIyIiByeD0iOCIvPjxjaXJjbGUgY3g9IjEwMCIgY3k9IjEyMCIgcj0iMzUiIGZpbGw9IiNGRjAwMUMiIHN0cm9rZT0iI2RjMjYyNiIgc3Ryb2tlLXdpZHRoPSIyIi8+PGcgdHJhbnNmb3JtPSJ0cmFuc2xhdGUoMTAwLCAxMjApIHNjYWxlKDAuOCkiPjxjaXJjbGUgY3g9IjAiIGN5PSItMTUiIHI9IjYiIGZpbGw9IiMwMDAwMDAiLz48cGF0aCBkPSJNLTggLTggTDggLTggTDEyIDggTDggMjAgTC04IDIwIEwtMTIgOCBaIiBmaWxsPSIjMDAwMDAwIi8+PHBhdGggZD0iTS0xMiAtNSBRLTIwIDAgLTE4IDE1IFEtMTUgMjUgLTggMjAgTC04IC04IFoiIGZpbGw9IiMwMDAwMDAiLz48cGF0aCBkPSJNMTIgLTUgUTIwIDAgMTggMTUgUTE1IDI1IDggMjAgTDggLTggWiIgZmlsbD0iIzAwMDAwMCIvPjxwYXRoIGQ9Ik0tOCAtNSBMLTE1IC0yIEwtMTIgOCBMLTggNSBaIiBmaWxsPSIjMDAwMDAwIi8+PHBhdGggZD0iTTggLTUgTDE1IC0yIEwxMiA4IEw4IDUgWiIgZmlsbD0iIzAwMDAwMCIvPjxwYXRoIGQ9Ik0tNCAyMCBMLTYgMzUgTC0yIDM1IEwwIDIwIFoiIGZpbGw9IiMwMDAwMDAiLz48cGF0aCBkPSJNNCAyMCBMNiAzNSBMMiAzNSBMMCAyMCBaIiBmaWxsPSIjMDAwMDAwIi8+PC9nPjx0ZXh0IHg9IjEwMCIgeT0iMjAwIiBmb250LWZhbWlseT0iQXJpYWwsIHNhbnMtc2VyaWYiIGZvbnQtc2l6ZT0iMTQiIGZvbnQtd2VpZ2h0PSJib2xkIiBmaWxsPSIjZmZmZmZmIiB0ZXh0LWFuY2hvcj0ibWlkZGxlIj5JTUFHRTwvdGV4dD48dGV4dCB4PSIxMDAiIHk9IjIyMCIgZm9udC1mYW1pbHk9IkFyaWFsLCBzYW5zLXNlcmlmIiBmb250LXNpemU9IjE0IiBmb250LXdlaWdodD0iYm9sZCIgZmlsbD0iI2ZmZmZmZiIgdGV4dC1hbmNob3I9Im1pZGRsZSI+Q09NSU5HIFRPT048L3RleHQ+PHJlY3QgeD0iMTAiIHk9IjEwIiB3aWR0aD0iMjAiIGhlaWdodD0iMyIgZmlsbD0iI0ZGMDAxQyIvPjxyZWN0IHg9IjEwIiB5PSIxMCIgd2lkdGg9IjMiIGhlaWdodD0iMjAiIGZpbGw9IiNGRjAwMUMiLz48cmVjdCB4PSIxNzAiIHk9IjEwIiB3aWR0aD0iMjAiIGhlaWdodD0iMyIgZmlsbD0iI0ZGMDAxQyIvPjxyZWN0IHg9IjE4NyIgeT0iMTAiIHdpZHRoPSIzIiBoZWlnaHQ9IjIwIiBmaWxsPSIjRkYwMDFDIi8+PHJlY3QgeD0iMTAiIHk9IjI4NyIgd2lkdGg9IjIwIiBoZWlnaHQ9IjMiIGZpbGw9IiNGRjAwMUMiLz48cmVjdCB4PSIxMCIgeT0iMjcwIiB3aWR0aD0iMyIgaGVpZ2h0PSIyMCIgZmlsbD0iI0ZGMDAxQyIvPjxyZWN0IHg9IjE3MCIgeT0iMjg3IiB3aWR0aD0iMjAiIGhlaWdodD0iMyIgZmlsbD0iI0ZGMDAxQyIvPjxyZWN0IHg9IjE4NyIgeT0iMjcwIiB3aWR0aD0iMyIgaGVpZ2h0PSIyMCIgZmlsbD0iI0ZGMDAxQyIvPjwvc3ZnPg==';
        }}
      />
    );
  }

  return (
    <img
      src={src}
      alt={alt}
      className={cn("w-full h-full object-cover rounded-lg", className)}
      onClick={onClick}
      onError={(e) => {
        // Fallback to superhero logo
        const target = e.target as HTMLImageElement;
        target.src = "/uploads/superhero-fallback.svg";
        target.onerror = () => {
          // Final fallback to embedded SVG
          target.src = 'data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iMjAwIiBoZWlnaHQ9IjMwMCIgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIj48ZGVmcz48bGluZWFyR3JhZGllbnQgaWQ9ImJnR3JhZGllbnQiIHgxPSIwJSIgeTE9IjAlIiB4Mj0iMTAwJSIgeTI9IjEwMCUiPjxzdG9wIG9mZnNldD0iMCUiIHN0eWxlPSJzdG9wLWNvbG9yOiMxZjI5Mzc7c3RvcC1vcGFjaXR5OjEiIC8+PHN0b3Agb2Zmc2V0PSIxMDAlIiBzdHlsZT0ic3RvcC1jb2xvcjojMTExODI3O3N0b3Atb3BhY2l0eToxIiAvPjwvbGluZWFyR3JhZGllbnQ+PC9kZWZzPjxyZWN0IHdpZHRoPSIxMDAlIiBoZWlnaHQ9IjEwMCUiIGZpbGw9InVybCgjYmdHcmFkaWVudCkiIHN0cm9rZT0iIzM3NDE1MSIgc3Ryb2tlLXdpZHRoPSIyIiByeD0iOCIvPjxjaXJjbGUgY3g9IjEwMCIgY3k9IjEyMCIgcj0iMzUiIGZpbGw9IiNGRjAwMUMiIHN0cm9rZT0iI2RjMjYyNiIgc3Ryb2tlLXdpZHRoPSIyIi8+PGcgdHJhbnNmb3JtPSJ0cmFuc2xhdGUoMTAwLCAxMjApIHNjYWxlKDAuOCkiPjxjaXJjbGUgY3g9IjAiIGN5PSItMTUiIHI9IjYiIGZpbGw9IiMwMDAwMDAiLz48cGF0aCBkPSJNLTggLTggTDggLTggTDEyIDggTDggMjAgTC04IDIwIEwtMTIgOCBaIiBmaWxsPSIjMDAwMDAwIi8+PHBhdGggZD0iTS0xMiAtNSBRLTIwIDAgLTE4IDE1IFEtMTUgMjUgLTggMjAgTC04IC04IFoiIGZpbGw9IiMwMDAwMDAiLz48cGF0aCBkPSJNMTIgLTUgUTIwIDAgMTggMTUgUTE1IDI1IDggMjAgTDggLTggWiIgZmlsbD0iIzAwMDAwMCIvPjxwYXRoIGQ9Ik0tOCAtNSBMLTE1IC0yIEwtMTIgOCBMLTggNSBaIiBmaWxsPSIjMDAwMDAwIi8+PHBhdGggZD0iTTggLTUgTDE1IC0yIEwxMiA4IEw4IDUgWiIgZmlsbD0iIzAwMDAwMCIvPjxwYXRoIGQ9Ik0tNCAyMCBMLTYgMzUgTC0yIDM1IEwwIDIwIFoiIGZpbGw9IiMwMDAwMDAiLz48cGF0aCBkPSJNNCAyMCBMNiAzNSBMMiAzNSBMMCAyMCBaIiBmaWxsPSIjMDAwMDAwIi8+PC9nPjx0ZXh0IHg9IjEwMCIgeT0iMjAwIiBmb250LWZhbWlseT0iQXJpYWwsIHNhbnMtc2VyaWYiIGZvbnQtc2l6ZT0iMTQiIGZvbnQtd2VpZ2h0PSJib2xkIiBmaWxsPSIjZmZmZmZmIiB0ZXh0LWFuY2hvcj0ibWlkZGxlIj5JTUFHRTwvdGV4dD48dGV4dCB4PSIxMDAiIHk9IjIyMCIgZm9udC1mYW1pbHk9IkFyaWFsLCBzYW5zLXNlcmlmIiBmb250LXNpemU9IjE0IiBmb250LXdlaWdodD0iYm9sZCIgZmlsbD0iI2ZmZmZmZiIgdGV4dC1hbmNob3I9Im1pZGRsZSI+Q09NSU5HIFRPT048L3RleHQ+PHJlY3QgeD0iMTAiIHk9IjEwIiB3aWR0aD0iMjAiIGhlaWdodD0iMyIgZmlsbD0iI0ZGMDAxQyIvPjxyZWN0IHg9IjEwIiB5PSIxMCIgd2lkdGg9IjMiIGhlaWdodD0iMjAiIGZpbGw9IiNGRjAwMUMiLz48cmVjdCB4PSIxNzAiIHk9IjEwIiB3aWR0aD0iMjAiIGhlaWdodD0iMyIgZmlsbD0iI0ZGMDAxQyIvPjxyZWN0IHg9IjE4NyIgeT0iMTAiIHdpZHRoPSIzIiBoZWlnaHQ9IjIwIiBmaWxsPSIjRkYwMDFDIi8+PHJlY3QgeD0iMTAiIHk9IjI4NyIgd2lkdGg9IjIwIiBoZWlnaHQ9IjMiIGZpbGw9IiNGRjAwMUMiLz48cmVjdCB4PSIxMCIgeT0iMjcwIiB3aWR0aD0iMyIgaGVpZ2h0PSIyMCIgZmlsbD0iI0ZGMDAxQyIvPjxyZWN0IHg9IjE3MCIgeT0iMjg3IiB3aWR0aD0iMjAiIGhlaWdodD0iMyIgZmlsbD0iI0ZGMDAxQyIvPjxyZWN0IHg9IjE4NyIgeT0iMjcwIiB3aWR0aD0iMyIgaGVpZ2h0PSIyMCIgZmlsbD0iI0ZGMDAxQyIvPjwvc3ZnPg==';
        };
      }}
    />
  );
}