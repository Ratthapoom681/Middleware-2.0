import { useEffect, useRef, useState } from 'react';

const CANVAS_WIDTH = 160;
const CANVAS_HEIGHT = 120;

const COLORS = {
  fur: '#8B9CB8',
  furDark: '#596A86',
  mask: '#E8ECF4',
  eye: '#2979FF',
  pupil: '#080B12',
  nose: '#1A1D2B',
  ear: '#C8A0A0',
  paw: '#DCE3EE',
};

function clamp(value, min = 0, max = 1) {
  return Math.min(max, Math.max(min, value));
}

function lerp(start, end, amount) {
  return start + (end - start) * amount;
}

function easeOutQuart(value) {
  return 1 - ((1 - value) ** 4);
}

function roundedRectPath(context, x, y, width, height, radius) {
  const safeRadius = Math.min(radius, width / 2, height / 2);
  context.beginPath();
  context.moveTo(x + safeRadius, y);
  context.lineTo(x + width - safeRadius, y);
  context.quadraticCurveTo(x + width, y, x + width, y + safeRadius);
  context.lineTo(x + width, y + height - safeRadius);
  context.quadraticCurveTo(x + width, y + height, x + width - safeRadius, y + height);
  context.lineTo(x + safeRadius, y + height);
  context.quadraticCurveTo(x, y + height, x, y + height - safeRadius);
  context.lineTo(x, y + safeRadius);
  context.quadraticCurveTo(x, y, x + safeRadius, y);
  context.closePath();
}

function drawEar(context, side, perk) {
  const left = side === 'left';
  const baseX = left ? 52 : 108;
  const direction = left ? -1 : 1;

  context.save();
  context.translate(baseX, 31);
  context.rotate(direction * perk * 0.045);
  context.beginPath();
  context.moveTo(0, 8);
  context.lineTo(direction * (12 + perk * 2), -27 - perk * 2);
  context.lineTo(direction * 29, 12);
  context.closePath();
  context.fillStyle = COLORS.fur;
  context.fill();
  context.strokeStyle = COLORS.furDark;
  context.lineWidth = 1.4;
  context.stroke();

  context.beginPath();
  context.moveTo(direction * 5, 3);
  context.lineTo(direction * (12 + perk), -19 - perk);
  context.lineTo(direction * 22, 7);
  context.closePath();
  context.fillStyle = COLORS.ear;
  context.globalAlpha = 0.82;
  context.fill();
  context.restore();
}

function drawEye(context, x, y, eyeOffsetX, eyeOffsetY, openness, scale) {
  if (openness < 0.18) {
    context.beginPath();
    context.moveTo(x - 7, y);
    context.quadraticCurveTo(x, y + 4, x + 7, y);
    context.strokeStyle = COLORS.furDark;
    context.lineWidth = 2.2;
    context.lineCap = 'round';
    context.stroke();
    return;
  }

  context.save();
  context.translate(x, y);
  context.scale(1, Math.max(0.12, openness));
  context.beginPath();
  context.ellipse(0, 0, 8.5, 7.5, 0, 0, Math.PI * 2);
  context.fillStyle = '#FFFFFF';
  context.fill();
  context.strokeStyle = 'rgba(26, 29, 43, 0.28)';
  context.lineWidth = 1;
  context.stroke();

  context.beginPath();
  context.arc(eyeOffsetX, 0.5 + eyeOffsetY, 4.1 * scale, 0, Math.PI * 2);
  context.fillStyle = COLORS.eye;
  context.fill();

  context.beginPath();
  context.arc(eyeOffsetX, 0.5 + eyeOffsetY, 2 * scale, 0, Math.PI * 2);
  context.fillStyle = COLORS.pupil;
  context.fill();

  context.beginPath();
  context.arc(eyeOffsetX - 1.25, eyeOffsetY - 1, 0.9, 0, Math.PI * 2);
  context.fillStyle = 'rgba(255, 255, 255, 0.9)';
  context.fill();
  context.restore();
}

function drawPaw(context, side, cover) {
  const left = side === 'left';
  const restX = left ? 39 : 97;
  const coverX = left ? 49 : 87;
  const x = lerp(restX, coverX, cover);
  const y = lerp(94, 47, cover);
  const centerX = x + 12;

  context.save();
  context.beginPath();
  context.moveTo(left ? 48 : 112, 116);
  context.quadraticCurveTo(centerX, 96, centerX, y + 15);
  context.strokeStyle = COLORS.fur;
  context.lineWidth = 18;
  context.lineCap = 'round';
  context.stroke();

  roundedRectPath(context, x, y, 24, 29, 10);
  context.fillStyle = COLORS.paw;
  context.fill();
  context.strokeStyle = COLORS.furDark;
  context.lineWidth = 1.2;
  context.stroke();

  context.strokeStyle = 'rgba(89, 106, 134, 0.5)';
  context.lineWidth = 1;
  context.lineCap = 'round';
  for (let index = 0; index < 3; index += 1) {
    const toeX = x + 7 + index * 5;
    context.beginPath();
    context.moveTo(toeX, y + 4);
    context.lineTo(toeX, y + 8);
    context.stroke();
  }
  context.restore();
}

function drawHusky(context, animation) {
  context.clearRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);

  context.save();
  context.translate(80 + animation.headX, 64 + animation.headY);
  context.rotate(animation.headTilt);
  context.translate(-80, -64);

  drawEar(context, 'left', animation.earPerk);
  drawEar(context, 'right', animation.earPerk);

  context.beginPath();
  context.moveTo(80, 19);
  context.bezierCurveTo(108, 18, 125, 37, 122, 66);
  context.bezierCurveTo(120, 91, 104, 104, 80, 106);
  context.bezierCurveTo(56, 104, 40, 91, 38, 66);
  context.bezierCurveTo(35, 37, 52, 18, 80, 19);
  context.closePath();
  context.fillStyle = COLORS.fur;
  context.fill();
  context.strokeStyle = COLORS.furDark;
  context.lineWidth = 1.5;
  context.stroke();

  context.beginPath();
  context.moveTo(48, 47);
  context.bezierCurveTo(57, 33, 68, 35, 80, 49);
  context.bezierCurveTo(92, 35, 103, 33, 112, 47);
  context.bezierCurveTo(113, 68, 105, 94, 80, 99);
  context.bezierCurveTo(55, 94, 47, 68, 48, 47);
  context.closePath();
  context.fillStyle = COLORS.mask;
  context.fill();

  context.beginPath();
  context.moveTo(80, 48);
  context.lineTo(74, 39);
  context.lineTo(80, 28);
  context.lineTo(86, 39);
  context.closePath();
  context.fillStyle = COLORS.furDark;
  context.globalAlpha = 0.72;
  context.fill();
  context.globalAlpha = 1;

  const eyeOpenness = 1 - animation.blink;
  drawEye(
    context,
    63.5,
    59,
    animation.eyeX,
    animation.eyeY,
    eyeOpenness,
    animation.eyeScale,
  );
  drawEye(
    context,
    96.5,
    59,
    animation.eyeX,
    animation.eyeY,
    eyeOpenness,
    animation.eyeScale,
  );

  context.strokeStyle = COLORS.furDark;
  context.lineWidth = 1.8;
  context.lineCap = 'round';
  context.beginPath();
  context.moveTo(56, 49 - animation.earPerk);
  context.quadraticCurveTo(63, 45, 70, 49);
  context.moveTo(90, 49);
  context.quadraticCurveTo(97, 45 - animation.earPerk, 104, 49);
  context.stroke();

  context.beginPath();
  context.ellipse(80, 76, 8.2, 5.8, 0, 0, Math.PI * 2);
  context.fillStyle = COLORS.nose;
  context.fill();
  context.beginPath();
  context.arc(77.5, 74.2, 1.25, 0, Math.PI * 2);
  context.fillStyle = 'rgba(255, 255, 255, 0.55)';
  context.fill();

  context.beginPath();
  context.moveTo(80, 81);
  context.quadraticCurveTo(76, 86, 71, 84);
  context.moveTo(80, 81);
  context.quadraticCurveTo(84, 86, 89, 84);
  context.strokeStyle = COLORS.furDark;
  context.lineWidth = 1.4;
  context.stroke();
  context.restore();

  drawPaw(context, 'left', animation.leftPaw);
  drawPaw(context, 'right', animation.rightPaw);
}

function usePrefersReducedMotion() {
  const [reducedMotion, setReducedMotion] = useState(() => (
    typeof window !== 'undefined'
      ? window.matchMedia('(prefers-reduced-motion: reduce)').matches
      : false
  ));

  useEffect(() => {
    const mediaQuery = window.matchMedia('(prefers-reduced-motion: reduce)');
    const handleChange = (event) => setReducedMotion(event.matches);
    mediaQuery.addEventListener('change', handleChange);
    return () => mediaQuery.removeEventListener('change', handleChange);
  }, []);

  return reducedMotion;
}

function StaticHusky() {
  return (
    <svg className="husky-static" viewBox="0 0 160 120" aria-hidden="true">
      <path d="M52 34 40 4 67 25M108 34l12-30-27 21" fill={COLORS.fur}
        stroke={COLORS.furDark} strokeWidth="1.5" strokeLinejoin="round" />
      <path d="m49 24-7-15 17 14m52 1 7-15-17 14" fill="none"
        stroke={COLORS.ear} strokeWidth="5" strokeLinecap="round" />
      <path d="M80 19c28-1 45 18 42 47-2 25-18 38-42 40-24-2-40-15-42-40-3-29 14-48 42-47Z"
        fill={COLORS.fur} stroke={COLORS.furDark} strokeWidth="1.5" />
      <path d="M48 47c9-14 20-12 32 2 12-14 23-16 32-2 1 21-7 47-32 52-25-5-33-31-32-52Z"
        fill={COLORS.mask} />
      <path d="m80 48-6-9 6-11 6 11Z" fill={COLORS.furDark} opacity=".72" />
      <g fill="#fff" stroke="rgba(26,29,43,.28)">
        <ellipse cx="63.5" cy="59" rx="8.5" ry="7.5" />
        <ellipse cx="96.5" cy="59" rx="8.5" ry="7.5" />
      </g>
      <g fill={COLORS.eye}>
        <circle cx="63.5" cy="59.5" r="4.1" /><circle cx="96.5" cy="59.5" r="4.1" />
      </g>
      <g fill={COLORS.pupil}>
        <circle cx="63.5" cy="59.5" r="2" /><circle cx="96.5" cy="59.5" r="2" />
      </g>
      <ellipse cx="80" cy="76" rx="8.2" ry="5.8" fill={COLORS.nose} />
      <path d="M80 81q-4 5-9 3m9-3q4 5 9 3" fill="none" stroke={COLORS.furDark}
        strokeWidth="1.4" strokeLinecap="round" />
      <g fill={COLORS.paw} stroke={COLORS.furDark} strokeWidth="1.2">
        <rect x="39" y="92" width="24" height="28" rx="10" />
        <rect x="97" y="92" width="24" height="28" rx="10" />
      </g>
    </svg>
  );
}

export default function HuskyMascot({ focusedField, showPassword, caretPosition }) {
  const canvasRef = useRef(null);
  const behaviorRef = useRef({ focusedField, showPassword, caretPosition });
  const pointerRef = useRef({ active: false, clientX: 0, clientY: 0 });
  const reducedMotion = usePrefersReducedMotion();
  behaviorRef.current = { focusedField, showPassword, caretPosition };

  useEffect(() => {
    if (reducedMotion) return undefined;

    const canvas = canvasRef.current;
    const context = canvas?.getContext('2d');
    if (!canvas || !context) return undefined;

    const finePointerQuery = window.matchMedia('(any-pointer: fine)');
    const handlePointerMove = (event) => {
      if (!finePointerQuery.matches || event.pointerType === 'touch') return;
      pointerRef.current = {
        active: true,
        clientX: event.clientX,
        clientY: event.clientY,
      };
    };
    const clearPointer = () => {
      pointerRef.current = { ...pointerRef.current, active: false };
    };
    const handlePointerAvailability = (event) => {
      if (!event.matches) clearPointer();
    };

    window.addEventListener('pointermove', handlePointerMove, { passive: true });
    window.addEventListener('blur', clearPointer);
    document.documentElement.addEventListener('pointerleave', clearPointer);
    finePointerQuery.addEventListener('change', handlePointerAvailability);

    const animation = {
      headX: 0,
      headY: 0,
      headTilt: 0,
      eyeX: 0,
      eyeY: 0,
      eyeScale: 1,
      earPerk: 0,
      blink: 0,
      leftPaw: 0,
      rightPaw: 0,
      leftPawVelocity: 0,
      rightPawVelocity: 0,
      coverStartedAt: 0,
      wasCovering: false,
    };
    let animationFrame;
    let previousTime = performance.now();
    const startTime = previousTime;

    const updateSpring = (positionKey, velocityKey, target, deltaTime) => {
      const acceleration = ((target - animation[positionKey]) * 82)
        - (animation[velocityKey] * 16);
      animation[velocityKey] += acceleration * deltaTime;
      animation[positionKey] = clamp(
        animation[positionKey] + animation[velocityKey] * deltaTime,
      );
    };

    const render = (currentTime) => {
      const deltaTime = Math.min(0.05, (currentTime - previousTime) / 1000);
      const elapsed = (currentTime - startTime) / 1000;
      previousTime = currentTime;

      const bounds = canvas.getBoundingClientRect();
      const behavior = behaviorRef.current;
      const isUsername = behavior.focusedField === 'username';
      const isPassword = behavior.focusedField === 'password';
      const isCovering = isPassword && !behavior.showPassword;
      const isPasswordRevealed = isPassword && behavior.showPassword;
      const caret = clamp(behavior.caretPosition ?? 0.5);
      const caretDirection = (caret - 0.5) * 2;

      if (isCovering !== animation.wasCovering) {
        animation.leftPawVelocity = 0;
        animation.rightPawVelocity = 0;
        if (isCovering) animation.coverStartedAt = elapsed;
        animation.wasCovering = isCovering;
      }

      const pointer = pointerRef.current;
      const pointerX = pointer.active
        ? clamp(
          (pointer.clientX - (bounds.left + bounds.width / 2))
            / Math.max(1, window.innerWidth / 2),
          -1,
          1,
        )
        : 0;
      const pointerY = pointer.active
        ? clamp(
          (pointer.clientY - (bounds.top + bounds.height / 2))
            / Math.max(1, window.innerHeight / 2),
          -1,
          1,
        )
        : 0;

      let targetHeadX = 0;
      let targetHeadY = 0;
      let targetTilt = 0;
      let targetEyeX = 0;
      let targetEyeY = 0;
      let targetEyeScale = 1;
      let targetEarPerk = 0;
      let targetLeftPaw = isCovering ? 1 : 0;
      let targetRightPaw = isCovering ? 1 : 0;

      if (isCovering) {
        targetHeadY = 3;
        targetTilt = -0.025;
        targetEyeScale = 0.9;
        targetEarPerk = 0.25;
        const peekPhase = (elapsed - animation.coverStartedAt) % 8;
        if (peekPhase > 7 && peekPhase < 8) {
          const peek = Math.sin((peekPhase - 7) * Math.PI);
          targetRightPaw = 1 - peek * 0.7;
        }
      } else if (isPasswordRevealed) {
        targetHeadX = caretDirection * 8;
        targetHeadY = 2;
        targetTilt = caretDirection * 0.1;
        targetEyeX = caretDirection * 4;
        targetEyeY = 2;
        targetEyeScale = 1.22;
        targetEarPerk = 0.65;
      } else if (isUsername) {
        targetHeadX = caretDirection * 8;
        targetHeadY = 2;
        targetTilt = caretDirection * 0.1;
        targetEyeX = caretDirection * 4;
        targetEyeY = 2;
        targetEarPerk = 1;
      } else if (pointer.active) {
        targetHeadX = pointerX * 8;
        targetHeadY = pointerY * 4;
        targetTilt = pointerX * 0.12;
        targetEyeX = pointerX * 4;
        targetEyeY = pointerY * 2.5;
        targetEarPerk = 0.8;
      }

      const easing = easeOutQuart(clamp(deltaTime * 5.5));
      animation.headX = lerp(animation.headX, targetHeadX, easing);
      animation.headY = lerp(animation.headY, targetHeadY, easing);
      animation.headTilt = lerp(animation.headTilt, targetTilt, easing);
      animation.eyeX = lerp(animation.eyeX, targetEyeX, easeOutQuart(clamp(deltaTime * 8)));
      animation.eyeY = lerp(animation.eyeY, targetEyeY, easeOutQuart(clamp(deltaTime * 8)));
      animation.eyeScale = lerp(animation.eyeScale, targetEyeScale, easing);
      animation.earPerk = lerp(animation.earPerk, targetEarPerk, easing);

      const blinkPhase = elapsed % 4.2;
      const idleBlink = !behavior.focusedField && blinkPhase > 3.9
        ? Math.sin(((blinkPhase - 3.9) / 0.3) * Math.PI)
        : 0;
      animation.blink = isCovering ? 1 : clamp(idleBlink);

      updateSpring('leftPaw', 'leftPawVelocity', targetLeftPaw, deltaTime);
      updateSpring('rightPaw', 'rightPawVelocity', targetRightPaw, deltaTime);

      const deviceScale = Math.min(window.devicePixelRatio || 1, 2);
      const pixelWidth = Math.max(1, Math.round(bounds.width * deviceScale));
      const pixelHeight = Math.max(1, Math.round(bounds.height * deviceScale));
      if (canvas.width !== pixelWidth || canvas.height !== pixelHeight) {
        canvas.width = pixelWidth;
        canvas.height = pixelHeight;
      }
      context.setTransform(
        pixelWidth / CANVAS_WIDTH,
        0,
        0,
        pixelHeight / CANVAS_HEIGHT,
        0,
        0,
      );
      drawHusky(context, animation);
      animationFrame = requestAnimationFrame(render);
    };

    animationFrame = requestAnimationFrame(render);
    return () => {
      cancelAnimationFrame(animationFrame);
      window.removeEventListener('pointermove', handlePointerMove);
      window.removeEventListener('blur', clearPointer);
      document.documentElement.removeEventListener('pointerleave', clearPointer);
      finePointerQuery.removeEventListener('change', handlePointerAvailability);
    };
  }, [reducedMotion]);

  return (
    <div className="husky-canvas-wrapper" aria-hidden="true">
      {reducedMotion ? (
        <StaticHusky />
      ) : (
        <canvas ref={canvasRef} width={CANVAS_WIDTH} height={CANVAS_HEIGHT} />
      )}
    </div>
  );
}
