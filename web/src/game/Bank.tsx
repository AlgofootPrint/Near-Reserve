"use client";

import { RoundedBox } from "@react-three/drei";
import { useFrame } from "@react-three/fiber";
import { useMemo, useRef } from "react";
import * as THREE from "three";

export const ROOM = { w: 18, d: 14, h: 3.2 };
export const COUNTER_Z = -3;
export const VAULT = { x: 6, z: -6.8, r: 1.15 };

function canvasTexture(draw: (g: CanvasRenderingContext2D, w: number, h: number) => void, w: number, h: number, repeat?: [number, number]) {
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  draw(c.getContext("2d")!, w, h);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  if (repeat) {
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.repeat.set(...repeat);
  }
  return t;
}

function useTextures() {
  return useMemo(() => {
    const tiles = canvasTexture(
      (g, w, h) => {
        g.fillStyle = "#ece8df";
        g.fillRect(0, 0, w, h);
        g.fillStyle = "#d9d3c6";
        g.fillRect(0, 0, w / 2, h / 2);
        g.fillRect(w / 2, h / 2, w / 2, h / 2);
        g.strokeStyle = "rgba(0,0,0,0.08)";
        g.lineWidth = 2;
        g.strokeRect(0, 0, w, h);
      },
      128,
      128,
      [9, 7],
    );
    const wood = canvasTexture(
      (g, w, h) => {
        g.fillStyle = "#8a5a3a";
        g.fillRect(0, 0, w, h);
        for (let i = 0; i < 16; i++) {
          g.fillStyle = i % 2 ? "rgba(0,0,0,0.06)" : "rgba(255,255,255,0.04)";
          g.fillRect(0, (i * h) / 16, w, h / 16);
        }
      },
      64,
      256,
      [6, 2],
    );
    const sign = canvasTexture(
      (g, w, h) => {
        g.fillStyle = "#16302e";
        g.fillRect(0, 0, w, h);
        g.strokeStyle = "#d8b45c";
        g.lineWidth = 6;
        g.strokeRect(10, 10, w - 20, h - 20);
        g.fillStyle = "#f3e2b0";
        g.font = "700 92px Georgia, serif";
        g.textAlign = "center";
        g.textBaseline = "middle";
        g.fillText("NEAR RESERVE", w / 2, h / 2 - 18);
        g.font = "500 34px Georgia, serif";
        g.fillStyle = "#d8b45c";
        g.fillText("T R U S T   ·   B U T   ·   V E R I F Y", w / 2, h / 2 + 52);
      },
      1024,
      256,
    );
    const rug = canvasTexture(
      (g, w, h) => {
        g.fillStyle = "#7d1f2b";
        g.fillRect(0, 0, w, h);
        g.strokeStyle = "#d8b45c";
        g.lineWidth = 8;
        g.strokeRect(14, 14, w - 28, h - 28);
      },
      256,
      128,
    );
    const atm = canvasTexture(
      (g, w, h) => {
        g.fillStyle = "#123";
        g.fillRect(0, 0, w, h);
        g.fillStyle = "#7ff5ff";
        g.font = "600 28px sans-serif";
        g.textAlign = "center";
        g.fillText("ATM", w / 2, h / 2 + 10);
      },
      128,
      96,
    );
    // NEAR plaque: the N logomark drawn as rounded strokes, with the wordmark beneath.
    const nearLogo = canvasTexture(
      (g, w, h) => {
        g.fillStyle = "#111315";
        g.beginPath();
        g.roundRect(0, 0, w, h, 48);
        g.fill();
        g.strokeStyle = "#ffffff";
        g.lineWidth = 50;
        g.lineCap = "round";
        g.lineJoin = "round";
        g.beginPath();
        g.moveTo(150, 360);
        g.lineTo(150, 110);
        g.lineTo(362, 360);
        g.lineTo(362, 110);
        g.stroke();
        g.fillStyle = "#ffffff";
        g.font = "800 120px 'Space Grotesk', Arial, sans-serif";
        g.textAlign = "center";
        g.textBaseline = "middle";
        g.fillText("NEAR", w / 2, 530);
      },
      512,
      640,
    );
    const asphalt = canvasTexture(
      (g, w, h) => {
        g.fillStyle = "#43474c";
        g.fillRect(0, 0, w, h);
        let seed = 7;
        const rand = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
        for (let i = 0; i < 900; i++) {
          g.fillStyle = rand() > 0.5 ? "rgba(255,255,255,0.05)" : "rgba(0,0,0,0.08)";
          g.fillRect(rand() * w, rand() * h, 2, 2);
        }
      },
      128,
      128,
      [24, 24],
    );
    return { tiles, wood, sign, rug, atm, nearLogo, asphalt };
  }, []);
}

const Wall = ({ pos, size, color = "#e9e2d3" }: { pos: [number, number, number]; size: [number, number, number]; color?: string }) => (
  <mesh position={pos} castShadow receiveShadow>
    <boxGeometry args={size} />
    <meshStandardMaterial color={color} roughness={0.9} />
  </mesh>
);

function Plant({ pos, scale = 1 }: { pos: [number, number, number]; scale?: number }) {
  return (
    <group position={pos} scale={scale}>
      <mesh position={[0, 0.25, 0]} castShadow>
        <cylinderGeometry args={[0.24, 0.18, 0.5, 16]} />
        <meshStandardMaterial color="#d9cbb3" roughness={0.8} />
      </mesh>
      {[0, 1.2, 2.4, 3.6, 4.8].map((a, i) => (
        <mesh key={i} position={[Math.cos(a) * 0.12, 0.75 + (i % 2) * 0.18, Math.sin(a) * 0.12]} rotation={[Math.cos(a) * 0.4, 0, Math.sin(a) * 0.4]} castShadow>
          <coneGeometry args={[0.16, 0.7, 6]} />
          <meshStandardMaterial color={i % 2 ? "#2f7d4f" : "#3d9a5f"} roughness={0.8} />
        </mesh>
      ))}
    </group>
  );
}

function Sofa({ pos, rot = 0, color = "#2e5d55" }: { pos: [number, number, number]; rot?: number; color?: string }) {
  return (
    <group position={pos} rotation={[0, rot, 0]}>
      <RoundedBox args={[2, 0.42, 0.85]} radius={0.08} position={[0, 0.3, 0]} castShadow receiveShadow>
        <meshStandardMaterial color={color} roughness={0.9} />
      </RoundedBox>
      <RoundedBox args={[2, 0.55, 0.22]} radius={0.08} position={[0, 0.68, -0.32]} castShadow>
        <meshStandardMaterial color={color} roughness={0.9} />
      </RoundedBox>
      {[-1, 1].map((s) => (
        <RoundedBox key={s} args={[0.2, 0.55, 0.85]} radius={0.06} position={[s * 0.95, 0.45, 0]} castShadow>
          <meshStandardMaterial color={color} roughness={0.9} />
        </RoundedBox>
      ))}
    </group>
  );
}

function Stanchions() {
  const posts: [number, number][] = [];
  for (const x of [0.45, 1.95]) for (const z of [-1.1, 0.4, 1.9, 3.4, 4.9]) posts.push([x, z]);
  return (
    <group>
      {posts.map(([x, z]) => (
        <group key={`${x}${z}`} position={[x, 0, z]}>
          <mesh position={[0, 0.03, 0]}>
            <cylinderGeometry args={[0.15, 0.17, 0.06, 16]} />
            <meshStandardMaterial color="#c9a54f" metalness={0.8} roughness={0.3} />
          </mesh>
          <mesh position={[0, 0.5, 0]} castShadow>
            <cylinderGeometry args={[0.03, 0.03, 0.95, 10]} />
            <meshStandardMaterial color="#c9a54f" metalness={0.8} roughness={0.3} />
          </mesh>
        </group>
      ))}
      {[0.45, 1.95].map((x) => (
        <mesh key={x} position={[x, 0.86, 1.9]}>
          <boxGeometry args={[0.04, 0.04, 6]} />
          <meshStandardMaterial color="#9b1c2c" roughness={0.6} />
        </mesh>
      ))}
    </group>
  );
}

/** The round vault door. `open()` is read every frame; it swings on its hinge. */
function VaultDoor({ open }: { open: () => boolean }) {
  const door = useRef<THREE.Group>(null);
  const wheel = useRef<THREE.Group>(null);
  useFrame((_, dt) => {
    const target = open() ? -1.75 : 0;
    if (door.current) door.current.rotation.y += (target - door.current.rotation.y) * Math.min(1, dt * 2.2);
    if (wheel.current && open()) wheel.current.rotation.z += dt * 2;
  });
  return (
    <group position={[VAULT.x, 1.35, VAULT.z]}>
      {/* recess with gold */}
      <mesh position={[0, 0, -0.05]}>
        <circleGeometry args={[VAULT.r, 40]} />
        <meshStandardMaterial color="#151a1f" />
      </mesh>
      {[-0.35, 0, 0.35].map((x, i) =>
        [-0.55, -0.4].map((y, j) => (
          <mesh key={`${i}${j}`} position={[x, y + j * 0.02, 0.05]}>
            <boxGeometry args={[0.3, 0.13, 0.2]} />
            <meshStandardMaterial color="#e7b93e" metalness={0.9} roughness={0.25} emissive="#7a5a10" emissiveIntensity={0.3} />
          </mesh>
        )),
      )}
      <mesh rotation={[0, 0, 0]} position={[0, 0, 0.06]}>
        <torusGeometry args={[VAULT.r + 0.08, 0.12, 12, 48]} />
        <meshStandardMaterial color="#8e979e" metalness={0.85} roughness={0.3} />
      </mesh>
      {/* door, hinged on its left edge */}
      <group position={[-VAULT.r, 0, 0.2]}>
        <group ref={door}>
          <group position={[VAULT.r, 0, 0]}>
            <mesh rotation={[Math.PI / 2, 0, 0]} castShadow>
              <cylinderGeometry args={[VAULT.r, VAULT.r, 0.28, 48]} />
              <meshStandardMaterial color="#b4bcc3" metalness={0.85} roughness={0.28} />
            </mesh>
            <mesh position={[0, 0, 0.15]}>
              <ringGeometry args={[0.55, 0.62, 40]} />
              <meshStandardMaterial color="#7c858c" metalness={0.8} roughness={0.35} />
            </mesh>
            <group ref={wheel} position={[0, 0, 0.2]}>
              {[0, 1, 2].map((i) => (
                <mesh key={i} rotation={[0, 0, (i * Math.PI) / 3]}>
                  <boxGeometry args={[0.9, 0.06, 0.06]} />
                  <meshStandardMaterial color="#d8b45c" metalness={0.9} roughness={0.25} />
                </mesh>
              ))}
              <mesh rotation={[Math.PI / 2, 0, 0]}>
                <cylinderGeometry args={[0.1, 0.1, 0.1, 20]} />
                <meshStandardMaterial color="#d8b45c" metalness={0.9} roughness={0.25} />
              </mesh>
            </group>
          </group>
        </group>
      </group>
    </group>
  );
}

function Car({ pos, rot, color }: { pos: [number, number, number]; rot: number; color: string }) {
  return (
    <group position={pos} rotation={[0, rot, 0]}>
      <RoundedBox args={[1.8, 0.55, 4]} radius={0.18} position={[0, 0.58, 0]} castShadow receiveShadow>
        <meshStandardMaterial color={color} metalness={0.4} roughness={0.35} />
      </RoundedBox>
      <RoundedBox args={[1.55, 0.5, 2.1]} radius={0.16} position={[0, 1.05, -0.2]} castShadow>
        <meshStandardMaterial color="#1e2a33" metalness={0.6} roughness={0.15} />
      </RoundedBox>
      {[
        [-0.86, 1.3],
        [0.86, 1.3],
        [-0.86, -1.3],
        [0.86, -1.3],
      ].map(([x, z]) => (
        <mesh key={`${x}${z}`} position={[x, 0.33, z]} rotation={[0, 0, Math.PI / 2]} castShadow>
          <cylinderGeometry args={[0.33, 0.33, 0.24, 18]} />
          <meshStandardMaterial color="#151515" roughness={0.8} />
        </mesh>
      ))}
      {[-0.6, 0.6].map((x) => (
        <mesh key={x} position={[x, 0.66, 2.0]}>
          <boxGeometry args={[0.38, 0.12, 0.04]} />
          <meshStandardMaterial color="#fff6d8" emissive="#fff6d8" emissiveIntensity={0.6} />
        </mesh>
      ))}
      {[-0.6, 0.6].map((x) => (
        <mesh key={x} position={[x, 0.66, -2.0]}>
          <boxGeometry args={[0.38, 0.1, 0.04]} />
          <meshStandardMaterial color="#c0262d" emissive="#c0262d" emissiveIntensity={0.4} />
        </mesh>
      ))}
    </group>
  );
}

function LampPost({ pos, rot = 0 }: { pos: [number, number, number]; rot?: number }) {
  return (
    <group position={pos} rotation={[0, rot, 0]}>
      <mesh position={[0, 2.5, 0]} castShadow>
        <cylinderGeometry args={[0.07, 0.1, 5, 10]} />
        <meshStandardMaterial color="#2b2f33" metalness={0.6} roughness={0.4} />
      </mesh>
      <mesh position={[0.5, 4.95, 0]}>
        <boxGeometry args={[1.1, 0.08, 0.12]} />
        <meshStandardMaterial color="#2b2f33" metalness={0.6} roughness={0.4} />
      </mesh>
      <mesh position={[0.95, 4.85, 0]}>
        <boxGeometry args={[0.5, 0.12, 0.3]} />
        <meshStandardMaterial color="#fffbe8" emissive="#fff3c4" emissiveIntensity={0.8} />
      </mesh>
    </group>
  );
}

function drawUsFlag(g: CanvasRenderingContext2D, w: number, h: number) {
  const stripe = h / 13;
  for (let i = 0; i < 13; i++) {
    g.fillStyle = i % 2 ? "#ffffff" : "#b22234";
    g.fillRect(0, i * stripe, w, stripe + 1);
  }
  const cw = w * 0.4;
  const ch = stripe * 7;
  g.fillStyle = "#3c3b6e";
  g.fillRect(0, 0, cw, ch);
  g.fillStyle = "#ffffff";
  const star = (cx: number, cy: number, r: number) => {
    g.beginPath();
    for (let i = 0; i < 10; i++) {
      const a = -Math.PI / 2 + (i * Math.PI) / 5;
      const rr = i % 2 ? r * 0.4 : r;
      g.lineTo(cx + Math.cos(a) * rr, cy + Math.sin(a) * rr);
    }
    g.fill();
  };
  // 50 stars: 9 rows alternating 6 and 5.
  for (let row = 0; row < 9; row++) {
    const cols = row % 2 ? 5 : 6;
    for (let col = 0; col < cols; col++) {
      const x = ((col * 2 + (row % 2 ? 2 : 1)) * cw) / 12;
      const y = ((row + 1) * ch) / 10;
      star(x, y, stripe * 0.32);
    }
  }
}

/** Flagpole with a US flag that ripples in the wind. */
function FlagPole({ pos }: { pos: [number, number, number] }) {
  const geo = useRef<THREE.PlaneGeometry>(null);
  const texture = useMemo(() => canvasTexture(drawUsFlag, 760, 400), []);
  const base = useRef<Float32Array | null>(null);
  const W = 1.9;
  const H = 1;
  useFrame(({ clock }) => {
    const g = geo.current;
    if (!g) return;
    const p = g.attributes.position as THREE.BufferAttribute;
    base.current ??= Float32Array.from(p.array as Float32Array);
    const t = clock.elapsedTime;
    for (let i = 0; i < p.count; i++) {
      const x = base.current[i * 3] + W / 2; // 0 at the pole
      const y = base.current[i * 3 + 1];
      p.setZ(i, Math.sin(x * 3 - t * 4 + y * 0.8) * 0.09 * (x / W));
    }
    p.needsUpdate = true;
    g.computeVertexNormals();
  });
  return (
    <group position={pos}>
      <mesh position={[0, 0.15, 0]} castShadow>
        <cylinderGeometry args={[0.35, 0.42, 0.3, 20]} />
        <meshStandardMaterial color="#9aa1a8" roughness={0.6} />
      </mesh>
      <mesh position={[0, 3.3, 0]} castShadow>
        <cylinderGeometry args={[0.05, 0.07, 6.4, 12]} />
        <meshStandardMaterial color="#d7dbe0" metalness={0.8} roughness={0.25} />
      </mesh>
      <mesh position={[0, 6.55, 0]}>
        <sphereGeometry args={[0.1, 14, 14]} />
        <meshStandardMaterial color="#d8b45c" metalness={0.9} roughness={0.2} />
      </mesh>
      <mesh position={[W / 2 + 0.05, 6.4 - H / 2, 0]} castShadow>
        <planeGeometry ref={geo} args={[W, H, 24, 6]} />
        <meshStandardMaterial map={texture} side={THREE.DoubleSide} roughness={0.8} />
      </mesh>
    </group>
  );
}

const STALL = 2.7;
const CAR_COLORS = ["#c8d1d9", "#b3261e", "#1f3b73", "#f2f2f2", "#2a2d31", "#e0a526", "#3c6e47"];

/** Painted stalls along the front and right of the building, some with cars. */
function ParkingLot() {
  const { w, d } = ROOM;
  const frontZ = d / 2 + 1.3; // stall start, just past the sidewalk
  const sideX = w / 2 + 1.3;
  const front = Array.from({ length: 11 }, (_, i) => -14 + i * STALL).filter((x) => x + STALL < -0.2 || x > 3.6);
  const side = Array.from({ length: 6 }, (_, i) => -8 + i * STALL);
  const line = (key: string, pos: [number, number, number], size: [number, number]) => (
    <mesh key={key} rotation={[-Math.PI / 2, 0, 0]} position={pos}>
      <planeGeometry args={size} />
      <meshStandardMaterial color="#f4f1e8" roughness={0.8} />
    </mesh>
  );
  // Deterministic "random" occupancy so every viewer sees the same lot.
  const parked = (i: number) => [0, 2, 3, 5, 7, 8].includes(i);

  return (
    <group>
      {front.map((x, i) => (
        <group key={`f${x}`}>
          {line(`fl${x}`, [x, -0.01, frontZ + 2.5], [0.1, 5])}
          {line(`fr${x}`, [x + STALL, -0.01, frontZ + 2.5], [0.1, 5])}
          {parked(i) && <Car pos={[x + STALL / 2, 0, frontZ + 2.5]} rot={i % 3 === 0 ? Math.PI : 0} color={CAR_COLORS[i % CAR_COLORS.length]} />}
        </group>
      ))}
      {line("front-aisle", [0, -0.01, frontZ + 8.5], [32, 0.12])}
      {side.map((z, i) => (
        <group key={`s${z}`}>
          {line(`sl${z}`, [sideX + 2.5, -0.01, z], [5, 0.1])}
          {line(`sr${z}`, [sideX + 2.5, -0.01, z + STALL], [5, 0.1])}
          {parked(i + 1) && <Car pos={[sideX + 2.5, 0, z + STALL / 2]} rot={i % 2 ? Math.PI / 2 : -Math.PI / 2} color={CAR_COLORS[(i + 4) % CAR_COLORS.length]} />}
        </group>
      ))}
      <LampPost pos={[-13.5, 0, frontZ + 6]} />
      <LampPost pos={[13.5, 0, frontZ + 6]} rot={Math.PI} />
      <LampPost pos={[sideX + 6.5, 0, -9]} rot={Math.PI / 2} />
    </group>
  );
}

export function Bank({ vaultOpen }: { vaultOpen: () => boolean }) {
  const tex = useTextures();
  const { w, d, h } = ROOM;
  return (
    <group>
      {/* outside: parking lot */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.06, 0]} receiveShadow>
        <planeGeometry args={[90, 90]} />
        <meshStandardMaterial map={tex.asphalt} roughness={0.95} />
      </mesh>
      <mesh position={[0, -0.05, 0]} receiveShadow>
        <boxGeometry args={[w + 2.4, 0.08, d + 2.4]} />
        <meshStandardMaterial color="#b9b2a6" roughness={1} />
      </mesh>
      <mesh position={[1.7, -0.05, d / 2 + 2.6]} receiveShadow>
        <boxGeometry args={[3.2, 0.08, 3.2]} />
        <meshStandardMaterial color="#b9b2a6" roughness={1} />
      </mesh>
      <ParkingLot />
      {/* US flag by the entrance */}
      <FlagPole pos={[-1.6, 0, d / 2 + 0.75]} />

      {/* floors */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
        <planeGeometry args={[w, d]} />
        <meshStandardMaterial map={tex.tiles} roughness={0.35} metalness={0.05} />
      </mesh>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[-0.5, 0.005, (COUNTER_Z - d / 2) / 2 - 0.15]} receiveShadow>
        <planeGeometry args={[w - 1, -COUNTER_Z + d / 2 - 0.6]} />
        <meshStandardMaterial map={tex.wood} roughness={0.6} />
      </mesh>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[1.2, 0.006, d / 2 - 1.1]} receiveShadow>
        <planeGeometry args={[3, 1.6]} />
        <meshStandardMaterial map={tex.rug} roughness={1} />
      </mesh>

      {/* walls: full height at back and left, low at right and front (dollhouse cutaway) */}
      <Wall pos={[0, h / 2, -d / 2]} size={[w + 0.5, h, 0.25]} />
      <Wall pos={[-w / 2, h / 2, 0]} size={[0.25, h, d + 0.5]} />
      <Wall pos={[w / 2, 0.3, 0]} size={[0.25, 0.6, d + 0.5]} color="#d6cdbb" />
      <Wall pos={[-w / 4 - 0.35, 0.3, d / 2]} size={[w / 2 - 0.2, 0.6, 0.25]} color="#d6cdbb" />
      <Wall pos={[w / 4 + 1.95, 0.3, d / 2]} size={[w / 2 - 3.9, 0.6, 0.25]} color="#d6cdbb" />
      {/* wainscot */}
      <Wall pos={[0, 0.5, -d / 2 + 0.14]} size={[w, 1, 0.03]} color="#1f3a37" />
      <Wall pos={[-w / 2 + 0.14, 0.5, 0]} size={[0.03, 1, d]} color="#1f3a37" />
      <Wall pos={[0, 1.02, -d / 2 + 0.16]} size={[w, 0.05, 0.05]} color="#d8b45c" />
      <Wall pos={[-w / 2 + 0.16, 1.02, 0]} size={[0.05, 0.05, d]} color="#d8b45c" />

      {/* sign */}
      <mesh position={[-1.2, 2.45, -d / 2 + 0.15]}>
        <planeGeometry args={[4.4, 1.1]} />
        <meshStandardMaterial map={tex.sign} roughness={0.5} />
      </mesh>

      {/* counter */}
      <group position={[-0.5, 0, COUNTER_Z]}>
        <RoundedBox args={[8.5, 1.05, 0.75]} radius={0.05} position={[0, 0.525, 0]} castShadow receiveShadow>
          <meshStandardMaterial map={tex.wood} roughness={0.55} />
        </RoundedBox>
        <mesh position={[0, 1.08, 0.05]} castShadow>
          <boxGeometry args={[8.7, 0.07, 0.95]} />
          <meshStandardMaterial color="#f1ede4" roughness={0.25} />
        </mesh>
        {[-4.2, -1.4, 1.4, 4.2].map((x) => (
          <mesh key={x} position={[x, 1.62, -0.05]}>
            <boxGeometry args={[0.07, 1.05, 0.07]} />
            <meshStandardMaterial color="#c9a54f" metalness={0.8} roughness={0.3} />
          </mesh>
        ))}
        <mesh position={[0, 1.62, -0.05]}>
          <boxGeometry args={[8.4, 1.05, 0.03]} />
          <meshPhysicalMaterial color="#cfeef0" transparent opacity={0.22} roughness={0.05} transmission={0.6} />
        </mesh>
        <mesh position={[0, 2.16, -0.05]}>
          <boxGeometry args={[8.5, 0.06, 0.09]} />
          <meshStandardMaterial color="#c9a54f" metalness={0.8} roughness={0.3} />
        </mesh>
        {/* teller monitor */}
        <group position={[0.8, 1.12, -0.25]} rotation={[0, Math.PI + 0.4, 0]}>
          <mesh position={[0, 0.22, 0]}>
            <boxGeometry args={[0.5, 0.32, 0.04]} />
            <meshStandardMaterial color="#1b1f24" emissive="#2b6d74" emissiveIntensity={0.4} />
          </mesh>
          <mesh position={[0, 0.04, 0]}>
            <boxGeometry args={[0.06, 0.1, 0.06]} />
            <meshStandardMaterial color="#333" />
          </mesh>
        </group>
      </group>

      {/* vault */}
      <VaultDoor open={vaultOpen} />

      <Stanchions />
      <Sofa pos={[-7.6, 0, -0.2]} rot={Math.PI / 2} />
      <Sofa pos={[-7.6, 0, 2.6]} rot={Math.PI / 2} color="#7b3f2e" />
      <mesh position={[-6.3, 0.25, 1.2]} castShadow>
        <cylinderGeometry args={[0.45, 0.45, 0.05, 24]} />
        <meshStandardMaterial color="#f1ede4" roughness={0.3} />
      </mesh>
      <mesh position={[-6.3, 0.12, 1.2]}>
        <cylinderGeometry args={[0.05, 0.05, 0.24, 10]} />
        <meshStandardMaterial color="#c9a54f" metalness={0.8} />
      </mesh>
      <Plant pos={[-8.2, 0, -6.2]} scale={1.3} />
      <Plant pos={[8.2, 0, 6.2]} />
      <Plant pos={[-8.2, 0, 6.2]} />
      <Plant pos={[3.6, 0, -6.2]} scale={1.1} />

      {/* NEAR plaque on the left wall, above the waiting area */}
      <group position={[-w / 2 + 0.15, 2.05, -2.5]} rotation={[0, Math.PI / 2, 0]}>
        <mesh position={[0, 0, -0.01]}>
          <boxGeometry args={[1.34, 1.66, 0.04]} />
          <meshStandardMaterial color="#d8b45c" metalness={0.7} roughness={0.3} />
        </mesh>
        <mesh position={[0, 0, 0.015]}>
          <planeGeometry args={[1.2, 1.5]} />
          <meshStandardMaterial map={tex.nearLogo} roughness={0.4} />
        </mesh>
      </group>

      {/* ATM on the left wall */}
      <group position={[-8.65, 0, -4.4]} rotation={[0, Math.PI / 2, 0]}>
        <RoundedBox args={[0.9, 1.8, 0.5]} radius={0.05} position={[0, 0.9, 0]} castShadow>
          <meshStandardMaterial color="#2c3e50" roughness={0.5} />
        </RoundedBox>
        <mesh position={[0, 1.35, 0.26]}>
          <planeGeometry args={[0.6, 0.42]} />
          <meshStandardMaterial map={tex.atm} emissive="#ffffff" emissiveMap={tex.atm} emissiveIntensity={0.5} />
        </mesh>
      </group>

      {/* wall clock */}
      <group position={[-6, 2.3, -d / 2 + 0.16]}>
        <mesh rotation={[Math.PI / 2, 0, 0]}>
          <cylinderGeometry args={[0.38, 0.38, 0.06, 32]} />
          <meshStandardMaterial color="#f7f3ea" />
        </mesh>
        <mesh position={[0, 0.1, 0.04]}>
          <boxGeometry args={[0.03, 0.22, 0.01]} />
          <meshStandardMaterial color="#111" />
        </mesh>
        <mesh position={[0.08, 0, 0.04]} rotation={[0, 0, Math.PI / 2]}>
          <boxGeometry args={[0.03, 0.16, 0.01]} />
          <meshStandardMaterial color="#111" />
        </mesh>
      </group>
    </group>
  );
}
