"use client";

import { useEffect, useState } from "react";

export function LogoLoading({ 
  className = "", 
  size = 24,
  autoPlay = true,
  onAnimationComplete
}: { 
  className?: string; 
  size?: number; 
  autoPlay?: boolean;
  onAnimationComplete?: () => void;
}) {
  const [animationPhase, setAnimationPhase] = useState<'dot' | 'exploding' | 'settled' | 'converging'>('dot');

  useEffect(() => {
    if (!autoPlay) return;

    const runAnimation = async () => {
      // Start with dot
      setAnimationPhase('dot');
      await new Promise(resolve => setTimeout(resolve, 300));
      
      // Explode outwards
      setAnimationPhase('exploding');
      await new Promise(resolve => setTimeout(resolve, 800));
      
      // Stay in final position
      setAnimationPhase('settled');
      await new Promise(resolve => setTimeout(resolve, 500));
      
      // Converge back to center
      setAnimationPhase('converging');
      await new Promise(resolve => setTimeout(resolve, 600));
      
      // Back to dot
      setAnimationPhase('dot');
      onAnimationComplete?.();
    };

    runAnimation();
  }, [autoPlay, onAnimationComplete]);

  // Center position
  const centerX = 10.9091;
  const centerY = 10.9091;

  // Define the arms with their final positions and distances from center
  const arms = [
    // Top (North) - length 4
    { name: "top", squares: [
      { x: 10.9091, y: 0, distance: 4 },
      { x: 10.9091, y: 2.18181, distance: 3 },
      { x: 10.9091, y: 4.36363, distance: 2 },
      { x: 10.9091, y: 6.54545, distance: 1 }
    ]},
    // Top-right (Northeast) - length 3
    { name: "top-right", squares: [
      { x: 15.2727, y: 6.54545, distance: 1 },
      { x: 17.4545, y: 4.36363, distance: 2 },
      { x: 19.6364, y: 2.18182, distance: 3 }
    ]},
    // Right (East) - length 4
    { name: "right", squares: [
      { x: 21.8182, y: 10.9091, distance: 4 },
      { x: 19.6364, y: 10.9091, distance: 3 },
      { x: 17.4545, y: 10.9091, distance: 2 },
      { x: 15.2727, y: 10.9091, distance: 1 }
    ]},
    // Bottom-right (Southeast) - length 3
    { name: "bottom-right", squares: [
      { x: 15.2727, y: 15.2727, distance: 1 },
      { x: 17.4545, y: 17.4546, distance: 2 },
      { x: 19.6364, y: 19.6364, distance: 3 }
    ]},
    // Bottom (South) - length 4
    { name: "bottom", squares: [
      { x: 10.9091, y: 21.8182, distance: 4 },
      { x: 10.9091, y: 19.6364, distance: 3 },
      { x: 10.9091, y: 17.4546, distance: 2 },
      { x: 10.9091, y: 15.2727, distance: 1 }
    ]},
    // Bottom-left (Southwest) - length 3
    { name: "bottom-left", squares: [
      { x: 6.54546, y: 15.2727, distance: 1 },
      { x: 4.36364, y: 17.4546, distance: 2 },
      { x: 2.18182, y: 19.6364, distance: 3 }
    ]},
    // Left (West) - length 4
    { name: "left", squares: [
      { x: 0, y: 10.9091, distance: 4 },
      { x: 2.18182, y: 10.9091, distance: 3 },
      { x: 4.36364, y: 10.9091, distance: 2 },
      { x: 6.54546, y: 10.9091, distance: 1 }
    ]},
    // Top-left (Northwest) - length 3
    { name: "top-left", squares: [
      { x: 6.54546, y: 6.54545, distance: 1 },
      { x: 4.36364, y: 4.36363, distance: 2 },
      { x: 2.18182, y: 2.18181, distance: 3 }
    ]}
  ];

  const getSquarePosition = (square: { x: number; y: number; distance: number }) => {
    if (animationPhase === 'dot' || animationPhase === 'converging') {
      return { x: centerX, y: centerY };
    }
    return { x: square.x, y: square.y };
  };

  const getTransitionDelay = (distance: number) => {
    if (animationPhase === 'exploding') {
      return `${(4 - distance) * 100}ms`; // Closer squares start first
    }
    if (animationPhase === 'converging') {
      return `${distance * 100}ms`; // Farther squares start first
    }
    return '0ms';
  };

  const getTransitionDuration = () => {
    if (animationPhase === 'exploding') return '800ms';
    if (animationPhase === 'converging') return '600ms';
    return '300ms';
  };

  // Show center dot only in dot phase
  const showCenterDot = animationPhase === 'dot';

  return (
    <div className={className} style={{ width: size, height: size }}>
      <svg
        width={size}
        height={size}
        viewBox="0 0 24 24"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
      >
        {/* Center dot - only visible in dot state */}
        {showCenterDot && (
          <rect
            x={centerX}
            y={centerY}
            width="2.18182"
            height="2.18182"
            fill="currentColor"
          />
        )}
        
        {/* Arms - only visible when not in dot state */}
        {animationPhase !== 'dot' && arms.map((arm) => 
          arm.squares.map((square, squareIndex) => {
            const position = getSquarePosition(square);
            return (
              <rect
                key={`${arm.name}-${squareIndex}`}
                x={position.x}
                y={position.y}
                width="2.18182"
                height="2.18182"
                fill="currentColor"
                style={{
                  transition: `all ${getTransitionDuration()} cubic-bezier(0.175, 0.885, 0.32, 1.275) ${getTransitionDelay(square.distance)}`,
                  transformOrigin: '50% 50%'
                }}
              />
            );
          })
        )}
      </svg>
    </div>
  );
}