"use client";

import { Html, RoundedBox } from "@react-three/drei";
import { useFrame } from "@react-three/fiber";
import { useMemo, useRef, useState, type ReactNode } from "react";
import * as THREE from "three";

export type Outfit = {
  skin: string;
  top: string;
  bottom: string;
  shoes: string;
  hair?: string;
  /** Coat skirt down to the knees. */
  coat?: boolean;
  shorts?: boolean;
  head?: "skimask" | "fedora" | "bucket" | "cap" | "bun" | "short";
  extras?: ("briefcase" | "tie" | "camera" | "glasses" | "headset" | "halo" | "floral" | "shirt" | "badge")[];
  accent?: string;
};

export const OUTFITS: Record<string, Outfit> = {
  suit: { skin: "#8d5a3b", top: "#24345e", bottom: "#1c2440", shoes: "#141414", head: "short", hair: "#1b1410", extras: ["shirt", "tie", "briefcase"], accent: "#c8322b" },
  mask: { skin: "#d6a27a", top: "#202227", bottom: "#2a2d33", shoes: "#111", head: "skimask", extras: [] },
  spy: { skin: "#e6b896", top: "#c9a46a", bottom: "#3a3530", shoes: "#2b211a", coat: true, head: "fedora", hair: "#3a2416", extras: ["glasses"], accent: "#5b4a33" },
  tourist: { skin: "#f0c9a5", top: "#e8634a", bottom: "#c9b48a", shoes: "#f2f2f2", shorts: true, head: "bucket", extras: ["floral", "camera"], accent: "#f2e6c8" },
  vera: { skin: "#a8714d", top: "#1f8a8a", bottom: "#24343a", shoes: "#1a1a1a", head: "bun", hair: "#22150f", extras: ["shirt", "headset", "halo", "badge"], accent: "#7ff5ff" },
  guard: { skin: "#6e4a33", top: "#1d2b45", bottom: "#1d2b45", shoes: "#0f0f0f", head: "cap", extras: ["badge"], accent: "#d4b04c" },
};

let floralTexture: THREE.CanvasTexture | null = null;
function floral() {
  if (floralTexture || typeof document === "undefined") return floralTexture;
  const c = document.createElement("canvas");
  c.width = c.height = 128;
  const g = c.getContext("2d")!;
  g.fillStyle = "#e8634a";
  g.fillRect(0, 0, 128, 128);
  const colors = ["#ffd447", "#3fc1a5", "#fff6e0", "#2f6fdb"];
  for (let i = 0; i < 26; i++) {
    const x = (i * 37) % 128;
    const y = (i * 53) % 128;
    g.fillStyle = colors[i % colors.length];
    for (let p = 0; p < 5; p++) {
      const a = (p / 5) * Math.PI * 2;
      g.beginPath();
      g.arc(x + Math.cos(a) * 6, y + Math.sin(a) * 6, 4.5, 0, Math.PI * 2);
      g.fill();
    }
  }
  floralTexture = new THREE.CanvasTexture(c);
  floralTexture.wrapS = floralTexture.wrapT = THREE.RepeatWrapping;
  floralTexture.colorSpace = THREE.SRGBColorSpace;
  return floralTexture;
}

const mat = (color: string, extra: Partial<THREE.MeshStandardMaterialParameters> = {}) => (
  <meshStandardMaterial color={color} roughness={0.75} {...extra} />
);

export type Target = { x: number; z: number; face: number };

/** Stable DOM container for speech bubbles; set by Scene before the canvas mounts. */
export const htmlPortal: { current: HTMLElement } = { current: null as unknown as HTMLElement };

type Props = {
  outfit: Outfit;
  /** Where the figure should be this frame. It walks there by itself. */
  target: () => Target;
  talking?: () => boolean;
  bubble?: ReactNode;
  tag?: ReactNode;
  onClick?: () => void;
  highlight?: string | null;
  start?: Target;
};

const SPEED = 2.4;

export function Figure({ outfit, target, talking, bubble, tag, onClick, highlight, start }: Props) {
  const root = useRef<THREE.Group>(null);
  const body = useRef<THREE.Group>(null);
  const limbs = useRef<Partial<Record<"legL" | "legR" | "armL" | "armR", THREE.Group>>>({});
  const head = useRef<THREE.Group>(null);
  const halo = useRef<THREE.Mesh>(null);
  const [seed] = useState(() => Math.random() * 10);
  const phase = useRef(0);
  const initial = useMemo(() => start ?? target(), []); // eslint-disable-line react-hooks/exhaustive-deps
  const has = (x: NonNullable<Outfit["extras"]>[number]) => outfit.extras?.includes(x);
  const topMap = has("floral") ? floral() : null;

  useFrame((state, dt) => {
    const g = root.current;
    if (!g) return;
    // Cap only huge gaps (tab switches), so walking keeps pace on slow machines too.
    dt = Math.min(dt, 0.5);
    const t = target();
    const dx = t.x - g.position.x;
    const dz = t.z - g.position.z;
    const dist = Math.hypot(dx, dz);
    const moving = dist > 0.05;
    if (moving) {
      const step = Math.min(dist, SPEED * dt);
      g.position.x += (dx / dist) * step;
      g.position.z += (dz / dist) * step;
    }
    const wantFace = moving ? Math.atan2(dx, dz) : t.face;
    let diff = wantFace - g.rotation.y;
    diff = Math.atan2(Math.sin(diff), Math.cos(diff));
    g.rotation.y += diff * Math.min(1, dt * 10);

    phase.current += dt * (moving ? 9 : 2);
    const p = phase.current + seed;
    const swing = moving ? Math.sin(p) * 0.6 : 0;
    const { legL, legR, armL, armR } = limbs.current;
    if (!legL || !legR || !armL || !armR) return;
    legL.rotation.x = swing;
    legR.rotation.x = -swing;
    const talk = talking?.() ?? false;
    armL.rotation.x = moving ? -swing * 0.8 : talk ? -0.35 + Math.sin(p * 2.2) * 0.25 : 0;
    armR.rotation.x = moving ? swing * 0.8 : 0;
    body.current!.position.y = moving ? Math.abs(Math.sin(p)) * 0.04 : Math.sin(p) * 0.008;
    head.current!.rotation.x = talk ? Math.sin(state.clock.elapsedTime * 9) * 0.06 : 0;
    head.current!.rotation.y = talk ? Math.sin(state.clock.elapsedTime * 2.1) * 0.15 : 0;
    if (halo.current) {
      halo.current.rotation.z += dt * (talk ? 3 : 1);
      (halo.current.material as THREE.MeshStandardMaterial).emissiveIntensity = talk ? 2.4 + Math.sin(state.clock.elapsedTime * 12) : 1.4;
    }
  });

  return (
    <group
      ref={root}
      position={[initial.x, 0, initial.z]}
      rotation={[0, initial.face, 0]}
      onClick={(e) => {
        if (!onClick) return;
        e.stopPropagation();
        onClick();
      }}
      onPointerOver={() => onClick && (document.body.style.cursor = "pointer")}
      onPointerOut={() => (document.body.style.cursor = "")}
    >
      {highlight && (
        <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.02, 0]}>
          <ringGeometry args={[0.42, 0.55, 40]} />
          <meshBasicMaterial color={highlight} transparent opacity={0.9} />
        </mesh>
      )}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.011, 0]}>
        <circleGeometry args={[0.34, 24]} />
        <meshBasicMaterial color="#000" transparent opacity={0.18} />
      </mesh>

      <group ref={body}>
        {/* legs */}
        {(["legL", "legR"] as const).map((name, i) => (
          <group key={name} ref={(g) => void (g && (limbs.current[name] = g))} position={[i ? 0.1 : -0.1, 0.86, 0]}>
            <mesh position={[0, outfit.shorts ? -0.16 : -0.39, 0]} castShadow>
              <capsuleGeometry args={[0.078, outfit.shorts ? 0.2 : 0.62, 4, 10]} />
              {mat(outfit.bottom)}
            </mesh>
            {outfit.shorts && (
              <mesh position={[0, -0.55, 0]} castShadow>
                <capsuleGeometry args={[0.06, 0.34, 4, 10]} />
                {mat(outfit.skin)}
              </mesh>
            )}
            <mesh position={[0, -0.82, 0.05]} castShadow>
              <boxGeometry args={[0.13, 0.08, 0.26]} />
              {mat(outfit.shoes)}
            </mesh>
          </group>
        ))}

        {/* torso */}
        <RoundedBox args={[0.44, 0.62, 0.26]} radius={0.08} position={[0, 1.16, 0]} castShadow>
          <meshStandardMaterial color={topMap ? "#ffffff" : outfit.top} map={topMap} roughness={0.8} />
        </RoundedBox>
        {outfit.coat && (
          <mesh position={[0, 0.72, 0]} castShadow>
            <cylinderGeometry args={[0.24, 0.31, 0.5, 14]} />
            {mat(outfit.top)}
          </mesh>
        )}
        {outfit.coat && (
          <mesh position={[0, 0.98, 0.135]}>
            <boxGeometry args={[0.46, 0.05, 0.02]} />
            {mat(outfit.accent ?? "#333")}
          </mesh>
        )}
        {has("shirt") && (
          <mesh position={[0, 1.3, 0.128]}>
            <boxGeometry args={[0.13, 0.3, 0.01]} />
            {mat("#f4f4f2")}
          </mesh>
        )}
        {has("tie") && (
          <mesh position={[0, 1.25, 0.136]}>
            <boxGeometry args={[0.045, 0.26, 0.012]} />
            {mat(outfit.accent ?? "#b22")}
          </mesh>
        )}
        {has("badge") && (
          <mesh position={[0.12, 1.32, 0.135]}>
            <boxGeometry args={[0.08, 0.05, 0.01]} />
            {mat(outfit.accent ?? "#fff", { metalness: 0.6, roughness: 0.3 })}
          </mesh>
        )}
        {has("camera") && (
          <group position={[0, 1.12, 0.17]}>
            <mesh>
              <boxGeometry args={[0.16, 0.1, 0.07]} />
              {mat("#1b1b1b")}
            </mesh>
            <mesh position={[0, 0, 0.05]} rotation={[Math.PI / 2, 0, 0]}>
              <cylinderGeometry args={[0.035, 0.035, 0.05, 14]} />
              {mat("#444", { metalness: 0.5 })}
            </mesh>
          </group>
        )}

        {/* arms */}
        {(["armL", "armR"] as const).map((name, i) => (
          <group key={name} ref={(g) => void (g && (limbs.current[name] = g))} position={[i ? 0.29 : -0.29, 1.42, 0]}>
            <mesh position={[0, -0.28, 0]} castShadow>
              <capsuleGeometry args={[0.058, 0.46, 4, 10]} />
              {mat(outfit.top)}
            </mesh>
            <mesh position={[0, -0.6, 0]} castShadow>
              <sphereGeometry args={[0.06, 12, 12]} />
              {mat(outfit.head === "skimask" ? "#1a1a1a" : outfit.skin)}
            </mesh>
            {i === 1 && has("briefcase") && (
              <group position={[0, -0.74, 0]}>
                <RoundedBox args={[0.32, 0.22, 0.08]} radius={0.02} castShadow>
                  {mat("#5a3a22")}
                </RoundedBox>
                <mesh position={[0, 0.13, 0]}>
                  <torusGeometry args={[0.05, 0.012, 6, 12, Math.PI]} />
                  {mat("#2a1a10")}
                </mesh>
              </group>
            )}
          </group>
        ))}

        {/* head */}
        <group ref={head} position={[0, 1.5, 0]}>
          <mesh position={[0, 0.05, 0]}>
            <cylinderGeometry args={[0.06, 0.07, 0.1, 10]} />
            {mat(outfit.head === "skimask" ? "#1c1c1c" : outfit.skin)}
          </mesh>
          <mesh position={[0, 0.22, 0]} castShadow>
            <sphereGeometry args={[0.15, 20, 20]} />
            {mat(outfit.head === "skimask" ? "#1c1c1c" : outfit.skin)}
          </mesh>
          {/* eyes */}
          {outfit.head === "skimask" && (
            <mesh position={[0, 0.24, 0.118]}>
              <boxGeometry args={[0.2, 0.06, 0.06]} />
              {mat(outfit.skin)}
            </mesh>
          )}
          {!has("glasses") &&
            [-0.05, 0.05].map((x) => (
              <mesh key={x} position={[x, 0.24, 0.142]}>
                <sphereGeometry args={[0.017, 8, 8]} />
                {mat("#111")}
              </mesh>
            ))}
          {has("glasses") && (
            <mesh position={[0, 0.245, 0.14]}>
              <boxGeometry args={[0.22, 0.05, 0.03]} />
              {mat("#0a0a0a", { metalness: 0.4, roughness: 0.2 })}
            </mesh>
          )}

          {outfit.head === "short" && (
            <mesh position={[0, 0.29, -0.01]}>
              <sphereGeometry args={[0.152, 20, 12, 0, Math.PI * 2, 0, Math.PI / 2.2]} />
              {mat(outfit.hair ?? "#222")}
            </mesh>
          )}
          {outfit.head === "bun" && (
            <>
              <mesh position={[0, 0.27, -0.015]}>
                <sphereGeometry args={[0.158, 20, 12, 0, Math.PI * 2, 0, Math.PI / 1.9]} />
                {mat(outfit.hair ?? "#222")}
              </mesh>
              <mesh position={[0, 0.36, -0.12]}>
                <sphereGeometry args={[0.075, 14, 14]} />
                {mat(outfit.hair ?? "#222")}
              </mesh>
            </>
          )}
          {outfit.head === "fedora" && (
            <>
              <mesh position={[0, 0.17, -0.05]}>
                <sphereGeometry args={[0.16, 16, 12, 0, Math.PI * 2, Math.PI / 2.4, Math.PI / 2]} />
                {mat(outfit.hair ?? "#222")}
              </mesh>
              <mesh position={[0, 0.33, 0]}>
                <cylinderGeometry args={[0.27, 0.27, 0.02, 24]} />
                {mat(outfit.accent ?? "#333")}
              </mesh>
              <mesh position={[0, 0.41, 0]}>
                <cylinderGeometry args={[0.13, 0.15, 0.16, 20]} />
                {mat(outfit.accent ?? "#333")}
              </mesh>
            </>
          )}
          {outfit.head === "bucket" && (
            <mesh position={[0, 0.35, 0]}>
              <cylinderGeometry args={[0.14, 0.23, 0.14, 20]} />
              {mat(outfit.accent ?? "#eee")}
            </mesh>
          )}
          {outfit.head === "cap" && (
            <>
              <mesh position={[0, 0.34, 0]}>
                <cylinderGeometry args={[0.16, 0.16, 0.09, 20]} />
                {mat(outfit.top)}
              </mesh>
              <mesh position={[0, 0.3, 0.13]}>
                <boxGeometry args={[0.2, 0.02, 0.12]} />
                {mat("#111")}
              </mesh>
            </>
          )}
          {has("headset") && (
            <>
              <mesh position={[0.15, 0.22, 0]} rotation={[0, 0, Math.PI / 2]}>
                <cylinderGeometry args={[0.04, 0.04, 0.03, 14]} />
                {mat("#e9f7f7")}
              </mesh>
              <mesh position={[0.12, 0.16, 0.08]} rotation={[0.9, 0, 0.3]}>
                <cylinderGeometry args={[0.008, 0.008, 0.14, 6]} />
                {mat("#e9f7f7")}
              </mesh>
              <mesh position={[0.08, 0.13, 0.14]}>
                <sphereGeometry args={[0.018, 8, 8]} />
                <meshStandardMaterial color={outfit.accent} emissive={outfit.accent} emissiveIntensity={2} />
              </mesh>
            </>
          )}
          {has("halo") && (
            <mesh ref={halo} position={[0, 0.56, 0]} rotation={[Math.PI / 2, 0, 0]}>
              <torusGeometry args={[0.17, 0.014, 8, 40]} />
              <meshStandardMaterial color={outfit.accent} emissive={outfit.accent} emissiveIntensity={1.4} toneMapped={false} />
            </mesh>
          )}
        </group>
      </group>

      {/* Keep the Html anchors mounted; mounting/unmounting them mid-render upsets React 19. */}
      <Html portal={htmlPortal} position={[0, 2.25, 0]} center zIndexRange={[20, 0]} style={{ pointerEvents: "none" }}>
        {tag}
      </Html>
      <Html portal={htmlPortal} position={[0, 2.55, 0]} center zIndexRange={[30, 0]} style={{ pointerEvents: "none" }}>
        {bubble}
      </Html>
    </group>
  );
}
