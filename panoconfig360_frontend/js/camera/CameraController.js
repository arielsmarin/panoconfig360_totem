/**
 * cameraController.js
 * Controlador modular de câmera com:
 *  - Limite de pitch igual ao Marzipano
 *  - Limite de zoom (FOV)
 *  - Animação suave entre pontos de interesse
 */

export const CAMERA_POIS = {
  backsplash: { yaw: 3.3, pitch: 0.03 },
  island: { yaw: -3.1, pitch: 0.16 },
  table: { yaw: 0.03, pitch: 0.28 },
  barbecue: { yaw: 2.83, pitch: -0.022 },
  countertop: { yaw: -1.76, pitch: -0.05 },
};

export function CreateCameraController(view) {
  console.log("[CameraController] Módulo carregado");

  let currentAnimation = null;

  // ________________________________ CONSTANTES DE LIMITES

  const PITCH_MIN = -Math.PI / 2 + 0.1; // ≈ -85°
  const PITCH_MAX = Math.PI / 2 - 0.1;  // ≈ +85°

  const FOV_MIN = (30 * Math.PI) / 180; // 30°
  const FOV_MAX = (100 * Math.PI) / 180; // 100°

  // ____________________________ REFORÇAR LIMITES DO VIEW

  // Intercepta o método de setPitch() e adiciona clamp
  const originalSetPitch = view.setPitch.bind(view);
  view.setPitch = (pitch) => {
    originalSetPitch(clampPitch(pitch));
  };

  // Intercepta o método de setFov() e adiciona clamp
  const originalSetFov = view.setFov.bind(view);
  view.setFov = (fov) => {
    originalSetFov(clampFov(fov));
  };


  // ________________________________ UTILITÁRIOS

  function shortestAngleDifference(a, b) {
    let diff = b - a;
    while (diff > Math.PI) diff -= 2 * Math.PI;
    while (diff < -Math.PI) diff += 2 * Math.PI;
    return diff;
  }

  function clampPitch(pitch) {
    return Math.min(Math.max(pitch, PITCH_MIN), PITCH_MAX);
  }

  function clampFov(fov) {
    return Math.min(Math.max(fov, FOV_MIN), FOV_MAX);
  }

  // ________________________________ ANIMAÇÃO DE FOCO

  function focusOn(key) {
    const poi = CAMERA_POIS[key];
    if (!poi) {
      console.warn(`[CameraController] Ponto "${key}" não encontrado.`);
      return;
    }

    localStorage.setItem("pano-camera-poi", key);

    const startYaw = view.yaw();
    const startPitch = view.pitch();
    const targetYaw = poi.yaw;
    const targetPitch = clampPitch(poi.pitch);

    const duration = 1200;
    const startTime = performance.now();

    if (currentAnimation) cancelAnimationFrame(currentAnimation);

    const yawDelta = shortestAngleDifference(startYaw, targetYaw);
    const pitchDelta = targetPitch - startPitch;

    function animate() {
      const now = performance.now();
      const elapsed = now - startTime;
      const t = Math.min(elapsed / duration, 1);
      const ease = t < 0.5 ? 2 * t * t : -1 + (4 - 2 * t) * t;

      const newYaw = startYaw + yawDelta * ease;
      const newPitch = clampPitch(startPitch + pitchDelta * ease);

      view.setYaw(newYaw);
      view.setPitch(newPitch);

      if (t < 1) currentAnimation = requestAnimationFrame(animate);
    }

    currentAnimation = requestAnimationFrame(animate);
  }

  // ________________________________ FIXAR FOV / ZOOM

  // Corrige o FOV inicial (se necessário)
  view.setFov(clampFov(view.fov()));


  // ________________________________ API PÚBLICA

  return {
    focusOn,
  };
}
