"use client";

import { useState } from "react";

export function LogoHover({ 
  className = "", 
  size = 24 
}: { 
  className?: string; 
  size?: number; 
}) {
  const [isHovered, setIsHovered] = useState(false);

  // Define the arms in clockwise order starting from top
  const arms = [
    // Top (North) - length 4
    { name: "top", squares: [
      { x: 10.9091, y: 0 },
      { x: 10.9091, y: 2.18181 },
      { x: 10.9091, y: 4.36363 },
      { x: 10.9091, y: 6.54545 }
    ]},
    // Top-right (Northeast) - length 3
    { name: "top-right", squares: [
      { x: 15.2727, y: 6.54545 },
      { x: 17.4545, y: 4.36363 },
      { x: 19.6364, y: 2.18182 }
    ]},
    // Right (East) - length 4
    { name: "right", squares: [
      { x: 21.8182, y: 10.9091 },
      { x: 19.6364, y: 10.9091 },
      { x: 17.4545, y: 10.9091 },
      { x: 15.2727, y: 10.9091 }
    ]},
    // Bottom-right (Southeast) - length 3
    { name: "bottom-right", squares: [
      { x: 15.2727, y: 15.2727 },
      { x: 17.4545, y: 17.4546 },
      { x: 19.6364, y: 19.6364 }
    ]},
    // Bottom (South) - length 4
    { name: "bottom", squares: [
      { x: 10.9091, y: 21.8182 },
      { x: 10.9091, y: 19.6364 },
      { x: 10.9091, y: 17.4546 },
      { x: 10.9091, y: 15.2727 }
    ]},
    // Bottom-left (Southwest) - length 3
    { name: "bottom-left", squares: [
      { x: 6.54546, y: 15.2727 },
      { x: 4.36364, y: 17.4546 },
      { x: 2.18182, y: 19.6364 }
    ]},
    // Left (West) - length 4
    { name: "left", squares: [
      { x: 0, y: 10.9091 },
      { x: 2.18182, y: 10.9091 },
      { x: 4.36364, y: 10.9091 },
      { x: 6.54546, y: 10.9091 }
    ]},
    // Top-left (Northwest) - length 3
    { name: "top-left", squares: [
      { x: 6.54546, y: 6.54545 },
      { x: 4.36364, y: 4.36363 },
      { x: 2.18182, y: 2.18181 }
    ]}
  ];

  const getSquareStyle = (armIndex: number) => {
    const baseStyle: React.CSSProperties = {
      transformOrigin: 'center',
      transition: 'all 0.3s ease-out'
    };

    if (!isHovered) {
      return baseStyle;
    }

    // Calculate animation delay based on arm index (clockwise from top)
    const delay = armIndex * 150; // 150ms between each arm
    
    return {
      ...baseStyle,
      animation: `logo-shrink-grow 1.2s ease-in-out ${delay}ms`,
      animationFillMode: 'both'
    };
  };

  return (
    <>
      <style>{`
        @keyframes logo-shrink-grow {
          0% { opacity: 1; transform: scale(1); }
          30% { opacity: 0.3; transform: scale(0.3); }
          70% { opacity: 0.3; transform: scale(0.3); }
          100% { opacity: 1; transform: scale(1); }
        }
      `}</style>
      <div
        className={className}
        onMouseEnter={() => setIsHovered(true)}
        onMouseLeave={() => setIsHovered(false)}
        style={{ width: size, height: size, cursor: 'pointer' }}
      >
        <svg
          width={size}
          height={size}
          viewBox="0 0 24 24"
          fill="none"
          xmlns="http://www.w3.org/2000/svg"
        >
          {arms.map((arm, armIndex) => 
            arm.squares.map((square, squareIndex) => (
              <rect
                key={`${arm.name}-${squareIndex}`}
                x={square.x}
                y={square.y}
                width="2.18182"
                height="2.18182"
                fill="currentColor"
                style={getSquareStyle(armIndex)}
              />
            ))
          )}
        </svg>
      </div>
    </>
  );
}