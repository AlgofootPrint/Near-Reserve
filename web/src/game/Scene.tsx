"use client";

import { ContactShadows, OrbitControls } from "@react-three/drei";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { Bank, COUNTER_Z, VAULT } from "./Bank";
import { Figure, htmlPortal, OUTFITS, type Target } from "./Figure";
import { elapsedOf, lineDuration, LOOKS, serverNow, useGame, type GameState, type Line } from "./store";

const VERA_SPOT: Target = { x: 0.2, z: COUNTER_Z - 0.85, face: 0 };
const COUNTER_SPOT: Target = { x: 0.2, z: COUNTER_Z + 0.95, face: Math.PI };
const QUEUE = [-0.2, 1.1, 2.4, 3.7].map((z) => ({ x: 1.2, z, face: Math.PI }));
const WAITING = [-0.9, 0.3, 1.9, 3.1].map((z) => ({ x: -6.4, z, face: Math.PI / 2 }));
const LINEUP = [-3.2, -1.6, 0, 1.6].map((x) => ({ x, z: -0.6, face: 0.35 }));
const EXIT = { x: 1.2, z: 9.5, face: 0 };
const TRAY = new THREE.Vector3(4.2, 1.05, -5.5);

const revealSince = (d: GameState) => (d.round?.result ? (serverNow() - d.round.revealAt) / 1000 : -1);

/** Where suspect `slot` should stand right now, from the shared round timeline. */
function targetFor(slot: number, d: GameState | null): Target {
  const r = d?.round;
  if (!d || !r) return QUEUE[slot];
  if (r.result) {
    const since = revealSince(d);
    const isClient = slot === r.result.clientSlot;
    if (isClient && since > 3) return COUNTER_SPOT;
    if (!isClient && since > 9) return { ...EXIT, x: EXIT.x + (slot - 1.5) * 0.6 };
    return LINEUP[slot];
  }
  const last = r.lines[r.lines.length - 1];
  const active = last ? r.order.indexOf(last.slot) : elapsedOf(r) > 1 ? 0 : -1;
  const idx = r.order.indexOf(slot);
  if (active >= 0 && idx < active) return WAITING[idx];
  if (idx === active) return COUNTER_SPOT;
  return QUEUE[Math.max(0, idx - active - 1)];
}

/**
 * The line a speaker is currently saying, if any. Only the most recent line in the
 * round can show, so Vera's and the customer's bubbles never stack on each other.
 */
function speaking(lines: Line[], who: (l: Line) => boolean, elapsed: number) {
  const l = lines[lines.length - 1];
  if (!l || !who(l)) return null;
  // A bubble stays up until the next line replaces it, with a generous cap so a
  // suspect's last line doesn't linger through the next walk-up.
  return elapsed - l.t < lineDuration(l.text) + 3 ? l : null;
}

/**
 * Vera's bubble opens to the right of her head (over the empty back wall), customers' to the
 * left. From the default camera the customer stands just below-left of Vera, so this keeps
 * each bubble off the other speaker. The tail points at whoever is talking.
 */
function Bubble({ line, vera }: { line: Line; vera?: boolean }) {
  return (
    <div
      className={`bubble-in relative w-max max-w-[160px] rounded-2xl px-2.5 py-1.5 text-[11px] leading-snug font-medium shadow-lg sm:max-w-[240px] sm:px-3 sm:py-2 sm:text-[12.5px] ${
        // Phones: centred above the speaker (only one bubble shows at a time, and a sideways
        // offset would run off a narrow screen). Wider: Vera's opens right, customers' left.
        vera ? "bg-[#103b3b] text-[#dffcfc] ring-1 ring-[#7ff5ff]/50 sm:translate-x-[58%]" : "bg-white text-[#1d1d1f] sm:-translate-x-[58%]"
      }`}
    >
      <span
        aria-hidden
        className={`absolute -bottom-1.5 left-1/2 size-3 -translate-x-1/2 rotate-45 ${vera ? "bg-[#103b3b] sm:left-5 sm:translate-x-0" : "bg-white sm:right-5 sm:left-auto sm:translate-x-0"}`}
      />
      {line.text}
      {line.approved && <div className="mt-1.5 rounded-md bg-[#ffb224] px-1.5 py-0.5 text-[10.5px] font-bold text-[#2a1a00]">✓ APPROVED</div>}
    </div>
  );
}

function Chip({ children, tone }: { children: React.ReactNode; tone: string }) {
  return (
    <div className={`rounded-full px-2 py-0.5 font-[family-name:var(--font-lilita)] text-[10.5px] tracking-wide whitespace-nowrap shadow-md sm:px-2.5 sm:text-[13px] ${tone}`}>{children}</div>
  );
}

/** An approval slip that flies from the counter to the pending tray by the vault. */
function Slip({ index, bornAt, color, verdict }: { index: number; bornAt: number; color: string; verdict: "pending" | "paid" | "rejected" }) {
  const ref = useRef<THREE.Mesh>(null);
  const from = new THREE.Vector3(COUNTER_SPOT.x, 1.2, COUNTER_Z);
  const to = TRAY.clone().add(new THREE.Vector3((index % 3) * 0.28 - 0.28, 0.03 + Math.floor(index / 3) * 0.04, 0));
  useFrame(() => {
    if (!ref.current) return;
    const k = Math.min(1, Math.max(0, (serverNow() - bornAt) / 1300));
    ref.current.position.lerpVectors(from, to, k);
    ref.current.position.y += Math.sin(k * Math.PI) * 1.4;
    ref.current.rotation.y = k * Math.PI * 2;
    const m = ref.current.material as THREE.MeshStandardMaterial;
    const c = verdict === "paid" ? "#3ddc84" : verdict === "rejected" ? "#ff4d3d" : color;
    m.color.set(c);
    m.emissive.set(verdict === "pending" ? "#000" : c);
  });
  return (
    <mesh ref={ref} castShadow>
      <boxGeometry args={[0.24, 0.025, 0.16]} />
      <meshStandardMaterial color={color} emissiveIntensity={0.8} />
    </mesh>
  );
}

/** Cash flies out of the vault to the real client after settlement. */
/**
 * Cash flies out of the vault to the real client after settlement: a fat stack of bills with a
 * gold glow that fans out mid-flight, then lands on the counter in front of the client.
 */
function Cash({ startAt }: { startAt: number }) {
  const group = useRef<THREE.Group>(null);
  const bills = useRef<THREE.Mesh[]>([]);
  const glow = useRef<THREE.PointLight>(null);
  const from = new THREE.Vector3(VAULT.x, 1.3, VAULT.z + 0.4);
  const to = new THREE.Vector3(COUNTER_SPOT.x, 1.16, COUNTER_Z + 0.15);
  const FLIGHT = 2000;
  useFrame(({ clock }) => {
    const g = group.current;
    if (!g) return;
    const k = (serverNow() - startAt) / FLIGHT;
    g.visible = k > 0;
    const e = Math.min(1, Math.max(0, k));
    g.position.lerpVectors(from, to, 1 - Math.pow(1 - e, 3));
    g.position.y += Math.sin(e * Math.PI) * 2.6;
    g.rotation.y = e * Math.PI * 4;
    // Bills fan out in flight and settle back into a neat stack on landing.
    const spread = Math.sin(e * Math.PI);
    bills.current.forEach((b, i) => {
      if (!b) return;
      b.position.y = i * 0.055 + spread * i * 0.08;
      b.rotation.y = spread * (i - 2.5) * 0.35;
    });
    if (glow.current) glow.current.intensity = e < 1 ? 6 : 2.5 + Math.sin(clock.elapsedTime * 4) * 1;
  });
  return (
    <group ref={group} visible={false} scale={1.7}>
      <pointLight ref={glow} color="#ffd75a" distance={4} intensity={0} position={[0, 0.4, 0]} />
      {[0, 1, 2, 3, 4, 5].map((i) => (
        <mesh key={i} ref={(m) => void (m && (bills.current[i] = m))} position={[0, i * 0.055, 0]} castShadow>
          <boxGeometry args={[0.36, 0.05, 0.18]} />
          <meshStandardMaterial color="#5fbf6e" emissive="#2f8a3c" emissiveIntensity={0.7} />
        </mesh>
      ))}
      {/* paper band around the stack */}
      <mesh position={[0, 0.14, 0]}>
        <boxGeometry args={[0.08, 0.32, 0.19]} />
        <meshStandardMaterial color="#f6e7b0" emissive="#b8861f" emissiveIntensity={0.4} />
      </mesh>
    </group>
  );
}

function Alarm({ active }: { active: () => boolean }) {
  const lights = useRef<THREE.PointLight[]>([]);
  useFrame((s) => {
    const on = active();
    const k = on ? (Math.sin(s.clock.elapsedTime * 10) + 1) / 2 : 0;
    lights.current.forEach((l) => l && (l.intensity = k * 28));
  });
  return (
    <>
      {[
        [-5, 3, -5],
        [5, 3, -5],
        [0, 3, 3],
      ].map((p, i) => (
        <pointLight key={i} ref={(l) => void (l && (lights.current[i] = l))} position={p as [number, number, number]} color="#ff2a1a" intensity={0} distance={12} />
      ))}
    </>
  );
}

function World() {
  const data = useGame((s) => s.data);
  const selected = useGame((s) => s.selected);
  const select = useGame((s) => s.select);
  const [, rerender] = useState(0);

  // Bubbles and tags are DOM; refresh them a few times a second.
  useEffect(() => {
    const t = setInterval(() => rerender((n) => n + 1), 250);
    return () => clearInterval(t);
  }, []);

  // Frame callbacks read the latest state straight from the store.
  const latest = () => useGame.getState().data;
  const r = data?.round;
  const elapsed = elapsedOf(r);
  const since = data ? revealSince(data) : -1;
  const result = r?.result;

  const veraLine = r ? speaking(r.lines, (l) => l.speaker === "vera", elapsed) : null;
  const approvals = r?.lines.filter((l) => l.approved) ?? [];

  return (
    <>
      <Bank
        vaultOpen={() => {
          const d = latest();
          const s = d ? revealSince(d) : -1;
          return s > 2.5 && s < 12;
        }}
      />

      <Figure
        outfit={OUTFITS.vera}
        target={() => VERA_SPOT}
        talking={() => {
          const rr = latest()?.round;
          return Boolean(rr && !rr.result && speaking(rr.lines, (l) => l.speaker === "vera", elapsedOf(rr)));
        }}
        bubble={veraLine && !result ? <Bubble line={veraLine} vera /> : null}
        tag={<Chip tone="bg-[#103b3b] text-[#7ff5ff]">VERA · AI</Chip>}
      />
      <Figure outfit={OUTFITS.guard} target={() => (since > 9 ? { x: 0, z: 6.6, face: 0 } : { x: -3.4, z: 5.6, face: Math.PI * 0.85 })} />

      {data?.suspects.map(({ slot, key, name }) => {
        const line = r && !result ? speaking(r.lines, (l) => l.speaker === "suspect" && l.slot === slot, elapsed) : null;
        const approved = approvals.some((l) => l.slot === slot);
        const isClient = result?.clientSlot === slot;
        let tag: React.ReactNode = <Chip tone="bg-white/90 text-[#1d1d1f]">{name}</Chip>;
        if (result && since > 1.5) {
          tag = isClient ? (
            <Chip tone="bg-[#3ddc84] text-[#06210f]">REAL ✓</Chip>
          ) : (
            <Chip tone="bg-[#ff4d3d] text-white">FAKE ✕{approved ? " · GOT 0" : ""}</Chip>
          );
        } else if (approved) {
          tag = <Chip tone="bg-[#ffb224] text-[#2a1a00]">{name} ✓</Chip>;
        }
        return (
          <Figure
            key={slot}
            outfit={OUTFITS[key]}
            target={() => targetFor(slot, latest())}
            talking={() => {
              const rr = latest()?.round;
              return Boolean(rr && !rr.result && speaking(rr.lines, (l) => l.speaker === "suspect" && l.slot === slot, elapsedOf(rr)));
            }}
            bubble={line ? <Bubble line={line} /> : null}
            tag={tag}
            onClick={() => select(slot)}
            highlight={selected === slot ? "#ffd23f" : result && since > 1.5 ? (isClient ? "#3ddc84" : "#ff4d3d") : null}
          />
        );
      })}

      {/* pending tray by the vault */}
      <group position={[TRAY.x, 0, TRAY.z]}>
        <mesh position={[0, 0.5, 0]} castShadow>
          <cylinderGeometry args={[0.45, 0.35, 1, 20]} />
          <meshStandardMaterial color="#2b3a3a" roughness={0.5} />
        </mesh>
        <mesh position={[0, 1.02, 0]}>
          <cylinderGeometry args={[0.55, 0.55, 0.04, 24]} />
          <meshStandardMaterial color="#c9a54f" metalness={0.8} roughness={0.3} />
        </mesh>
      </group>
      {r &&
        approvals.map((l, i) => {
          const req = result?.requests.filter((q) => q.slot === l.slot)[0];
          const verdict = !result || since < 3 ? "pending" : req?.status === "Paid" ? "paid" : "rejected";
          return <Slip key={`${r.id}-${i}`} index={i} bornAt={r.startedAt + l.t * 1000} color={LOOKS[data!.suspects[l.slot].key].color} verdict={verdict} />;
        })}
      {result && Number(result.clientPaid) > 0 && <Cash key={r!.id} startAt={r!.revealAt + 4200} />}
      <Alarm active={() => {
        const d = latest();
        if (!d?.round?.result) return false;
        const s = revealSince(d);
        return s > 2.5 && s < 7 && d.round.result.requests.some((q) => q.status === "RejectedImpostor");
      }} />
    </>
  );
}

/** Vertical field of view on wide screens, and the screen shape it was framed for. */
const BASE_FOV = 32;
const BASE_ASPECT = 1.35;

/**
 * The camera is framed for a wide screen. On narrower screens (tablets, phones in portrait)
 * widen the vertical field of view so the horizontal framing stays the same and the whole
 * bank still fits. Doesn't move the camera, so it never fights the player's orbit/zoom.
 */
function FitCamera() {
  const get = useThree((s) => s.get);
  const { width, height } = useThree((s) => s.size);
  const aspect = width / Math.max(1, height);
  // 0.82: on narrow screens keep the bank itself in frame and let the outer parking lot crop,
  // so the building and characters stay big enough to read.
  const halfWidth = Math.tan(THREE.MathUtils.degToRad(BASE_FOV / 2)) * BASE_ASPECT * 0.82;
  const fov = Math.min(62, Math.max(BASE_FOV, THREE.MathUtils.radToDeg(2 * Math.atan(halfWidth / aspect))));
  useEffect(() => {
    const camera = get().camera as THREE.PerspectiveCamera;
    camera.fov = fov;
    camera.updateProjectionMatrix();
  }, [get, fov]);
  return null;
}

export default function Scene() {
  return (
    <div className="absolute inset-0" ref={(d) => void (d && (htmlPortal.current = d))}>
      <Canvas shadows={{ type: THREE.PCFShadowMap }} dpr={[1, 2]} camera={{ position: [12.5, 15.5, 17.5], fov: 32, near: 0.5, far: 200 }} onPointerMissed={() => useGame.getState().select(null)}>
      <color attach="background" args={["#bfe3f5"]} />
      <fog attach="fog" args={["#bfe3f5", 45, 90]} />
      <hemisphereLight args={["#ffffff", "#9fbf8f", 0.9]} />
      <directionalLight
        position={[8, 16, 10]}
        intensity={2.2}
        castShadow
        shadow-mapSize={[2048, 2048]}
        shadow-camera-left={-14}
        shadow-camera-right={14}
        shadow-camera-top={14}
        shadow-camera-bottom={-14}
        shadow-bias={-0.0004}
      />
      <FitCamera />
      <World />
      <ContactShadows position={[0, 0.01, 0]} opacity={0.25} scale={30} blur={2.5} far={4} />
      <OrbitControls
        target={[-0.3, 0.6, -0.6]}
        enablePan={false}
        enableDamping
        minDistance={9}
        maxDistance={32}
        minPolarAngle={0.35}
        maxPolarAngle={1.15}
        minAzimuthAngle={-0.4}
        maxAzimuthAngle={1.5}
      />
      </Canvas>
    </div>
  );
}
