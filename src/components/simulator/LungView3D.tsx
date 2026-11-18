/**
 * 3D Lung View (presentation only). Draws the bundled Meshy GLBs and deforms
 * them from the same live presentation drive as the SVG view. Renders on
 * demand: a frame is drawn only when the drive changes, the canvas is on
 * screen and the page is visible — frozen buffers mean no GPU work.
 */
import { useEffect, useRef } from 'react';
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import lungsUrl from '@/assets/models/lung-sim-pro-lungs.glb?url';
import heartUrl from '@/assets/models/lung-sim-pro-heart.glb?url';
import airwaysUrl from '@/assets/models/lung-sim-pro-airways.glb?url';
import type { LungPose3D } from '@/lib/presentation/lungMotion';

export interface LungView3DProps {
  right: LungPose3D; // patient right = viewer left
  left: LungPose3D;
  ventricular: number; // 0–1 from ECG R timing
  atrial: number;
  tint: [number, number, number]; // lung tissue colour multiplier
  onReady?: () => void;
  onError?: () => void;
}

const VERT_DECL = `
uniform float uBase; uniform float uTidal; uniform float uBasal; uniform float uFlat; uniform float uDrop;
uniform vec3 uHilum; uniform float uYmin;
`;
const VERT_BODY = `
#include <begin_vertex>
{
  vec3 q = transformed - uHilum;
  float lowW = clamp((uHilum.y - transformed.y) / (uHilum.y - uYmin), 0.0, 1.0);
  lowW = lowW * lowW * (3.0 - 2.0 * lowW);
  // Dependent (posterior, -Z) zones carry more of the regional loss.
  float dep = 0.55 + 0.45 * clamp(0.5 - transformed.z * 1.4, 0.0, 1.0);
  float reg = uBasal * lowW * dep;
  float tid = uTidal * max(0.0, 1.0 - 2.0 * reg);
  float e = uBase + tid;
  q.xz *= 1.0 + 0.32 * e - 0.30 * reg;
  q.y *= q.y < 0.0 ? (1.0 + 0.70 * e - 0.55 * reg) : (1.0 + 0.25 * e);
  // Crowd lower-zone tissue toward the hilum (fissure/bronchovascular crowding).
  q.x *= 1.0 - 0.12 * reg;
  transformed = uHilum + q;
  // Trapped gas: caudal displacement and a flatter diaphragmatic surface.
  float floorY = uHilum.y + (uYmin - uHilum.y) * (1.0 + 0.70 * uBase) - uDrop;
  float wb = clamp((uHilum.y - transformed.y) / (uHilum.y - uYmin) - 0.55, 0.0, 1.0) / 0.45;
  transformed.y -= uDrop * lowW;
  transformed.y = mix(transformed.y, min(transformed.y, floorY + 0.06), uFlat * wb * 0.8);
}
`;

type LungUniforms = Record<'uBase' | 'uTidal' | 'uBasal' | 'uFlat' | 'uDrop' | 'uYmin', { value: number }> & { uHilum: { value: THREE.Vector3 } };

export default function LungView3D(props: LungView3DProps) {
  const hostRef = useRef<HTMLDivElement>(null);
  const propsRef = useRef(props);
  propsRef.current = props;
  const api = useRef<{ draw: () => void } | null>(null);

  useEffect(() => {
    const host = hostRef.current!;
    let disposed = false;
    let renderer: THREE.WebGLRenderer;
    try {
      renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: 'low-power' });
    } catch { props.onError?.(); return; }
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5));
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.9;
    renderer.domElement.setAttribute('aria-hidden', 'true');
    renderer.domElement.style.display = 'block';
    host.appendChild(renderer.domElement);

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(28, 1, 0.1, 50);
    camera.position.set(0, 0, 5.2); // front view along +Z
    camera.lookAt(0, 0.05, 0);
    scene.add(new THREE.HemisphereLight(0xfff4f0, 0x5a4448, 2.2));
    const key = new THREE.DirectionalLight(0xffffff, 2.2);
    key.position.set(-1.5, 2.5, 4);
    scene.add(key);
    const rim = new THREE.DirectionalLight(0xffd8d0, 0.8);
    rim.position.set(2, 1, -3);
    scene.add(rim);

    const lungU: { right?: LungUniforms; left?: LungUniforms } = {};
    const lungMats: THREE.MeshStandardMaterial[] = [];
    let heart: THREE.Object3D | null = null;
    let lastSig = '';
    let visible = true;
    let ready = false;

    const apply = () => {
      const p = propsRef.current;
      for (const side of ['right', 'left'] as const) {
        const u = lungU[side]; if (!u) continue;
        const s = p[side];
        u.uBase.value = s.base; u.uTidal.value = s.tidal; u.uBasal.value = s.basal; u.uFlat.value = s.flat; u.uDrop.value = s.drop;
      }
      for (const m of lungMats) m.color.setRGB(p.tint[0], p.tint[1], p.tint[2]);
      if (heart) {
        const v = 1 - 0.06 * p.ventricular - 0.015 * p.atrial;
        heart.scale.setScalar(HEART_SCALE * v);
      }
    };
    const sigOf = () => {
      const p = propsRef.current;
      const f = (s: LungPose3D) => `${s.base.toFixed(4)},${s.tidal.toFixed(4)},${s.basal.toFixed(3)},${s.flat.toFixed(3)}`;
      return `${f(p.right)}|${f(p.left)}|${p.ventricular.toFixed(3)}|${p.atrial.toFixed(3)}|${p.tint.join()}`;
    };
    const draw = (force = false) => {
      if (disposed || !ready || !visible || document.hidden) return;
      const sig = sigOf();
      if (!force && sig === lastSig) return; // frozen / unchanged: no GPU work
      lastSig = sig;
      apply();
      renderer.render(scene, camera);
    };
    api.current = { draw: () => draw() };

    const resize = () => {
      const w = Math.max(1, host.clientWidth), h = Math.max(1, host.clientHeight);
      renderer.setSize(w, h, false);
      renderer.domElement.style.width = '100%';
      renderer.domElement.style.height = '100%';
      camera.aspect = w / h;
      // Keep the whole thorax (≈2.6 × 2.5 units) in frame for any aspect.
      const fitH = Math.max(2.3, 2.15 / camera.aspect);
      camera.position.z = fitH / (2 * Math.tan((camera.fov * Math.PI) / 360));
      camera.updateProjectionMatrix();
      draw(true);
    };
    const ro = new ResizeObserver(resize);
    ro.observe(host);
    const io = new IntersectionObserver(([en]) => { visible = en.isIntersecting; if (visible) draw(true); });
    io.observe(host);
    const onVis = () => { if (!document.hidden) draw(true); };
    document.addEventListener('visibilitychange', onVis);

    const loader = new GLTFLoader();
    Promise.all([lungsUrl, heartUrl, airwaysUrl].map(u => loader.loadAsync(u))).then(([lungs, heartG, airways]) => {
      if (disposed) return;
      // Lungs keep their exported paired frame (RightLung at viewer left).
      lungs.scene.traverse(o => {
        const mesh = o as THREE.Mesh;
        if (!mesh.isMesh) return;
        const side = o.name === 'RightLung' || o.parent?.name === 'RightLung' ? 'right' : o.name === 'LeftLung' || o.parent?.name === 'LeftLung' ? 'left' : null;
        if (!side) return;
        mesh.geometry.computeBoundingBox();
        const bb = mesh.geometry.boundingBox!;
        const mat = (mesh.material as THREE.MeshStandardMaterial).clone();
        mesh.material = mat;
        lungMats.push(mat);
        // Hilum: medial edge, upper-middle height.
        const medialX = side === 'right' ? bb.max.x : bb.min.x;
        const u: LungUniforms = {
          uBase: { value: 0 }, uTidal: { value: 0 }, uBasal: { value: 0 }, uFlat: { value: 0 }, uDrop: { value: 0 },
          uYmin: { value: bb.min.y }, uHilum: { value: new THREE.Vector3(medialX, HILUM_Y, 0) },
        };
        lungU[side] = u;
        mat.onBeforeCompile = (sh) => {
          Object.assign(sh.uniforms, u);
          sh.vertexShader = VERT_DECL + sh.vertexShader.replace('#include <begin_vertex>', VERT_BODY);
        };
        mesh.frustumCulled = false;
      });
      scene.add(lungs.scene);

      // Airways: trachea above the apices, carina between the hila, set just
      // behind the anterior pleura so the bronchial tree is not drawn over it.
      airways.scene.scale.setScalar(AIRWAY_SCALE);
      airways.scene.position.set(0, AIRWAY_Y, -0.06);
      scene.add(airways.scene);

      // Heart: anterior-medial, lower mediastinum, apex toward patient left (viewer right).
      heart = heartG.scene;
      heart.scale.setScalar(HEART_SCALE);
      heart.position.set(0.1, -0.38, 0.38);
      heart.rotation.z = HEART_ROT_Z;
      scene.add(heart);

      ready = true;
      resize();
      host.dataset.sceneReady = 'true';
      propsRef.current.onReady?.();
    }).catch(() => { if (!disposed) propsRef.current.onError?.(); });

    return () => {
      disposed = true;
      api.current = null;
      ro.disconnect(); io.disconnect();
      document.removeEventListener('visibilitychange', onVis);
      scene.traverse(o => {
        const m = o as THREE.Mesh;
        if (m.isMesh) {
          m.geometry.dispose();
          const mats = Array.isArray(m.material) ? m.material : [m.material];
          mats.forEach(mt => {
            Object.values(mt as unknown as Record<string, unknown>).forEach(v => { if (v instanceof THREE.Texture) v.dispose(); });
            mt.dispose();
          });
        }
      });
      renderer.dispose();
      renderer.domElement.remove();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Each new live sample re-renders this component; draw only if the pose changed.
  useEffect(() => { api.current?.draw(); });

  return <div ref={hostRef} className="absolute inset-0" data-testid="lung-view-3d" />;
}

const HILUM_Y = 0.15;
const AIRWAY_SCALE = 0.62;
const AIRWAY_Y = 0.62;
const HEART_SCALE = 0.5;
const HEART_ROT_Z = 0;
