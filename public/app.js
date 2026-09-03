// ====================== Global State ======================
let currentMode = 'transfer';          // 'transfer' | 'receive'
let selectedImageData = null;         // base64 string of selected image
let isCameraActive = false;
let isTransferring = false;
let isReceiving = false;
let mediaPipeReady = false;
let handsInstance = null;
let videoElement = null;              // active video element
let canvasElement = null;             // active canvas element
let cameraStream = null;
let facingMode = 'environment';       // 'user' (front) or 'environment' (rear)
let countdownInterval = null;
let pollInterval = null;
let countdownSeconds = 15;            // default transfer/receive duration
let lastPalmCenter = null;            // updated in onHandResults

// ====================== Particle System ======================
let particles = [];
let particleTweens = [];

class Particle {
  constructor(x, y) {
    this.x = x;
    this.y = y;
    this.alpha = 1;
    this.scale = 1;
    this.color = `hsl(${Math.random() * 60 + 180}, 100%, 70%)`; // cyan-blue glow
  }
}

function createParticles(palmX, palmY, count = 40) {
  clearParticles();
  for (let i = 0; i < count; i++) {
    const p = new Particle(palmX, palmY);
    particles.push(p);
    const tween = gsap.to(p, {
      duration: 1.5 + Math.random() * 2,
      x: palmX + (Math.random() - 0.5) * 0.2,
      y: palmY - 0.2 - Math.random() * 0.4,
      alpha: 0,
      scale: 0.2,
      delay: Math.random() * 2,
      repeat: -1,
      repeatDelay: Math.random() * 1.5,
      ease: "power1.out",
      onUpdate: () => {}
    });
    particleTweens.push(tween);
  }
}

function clearParticles() {
  particles = [];
  particleTweens.forEach(tween => tween.kill());
  particleTweens = [];
}

// ====================== DOM Elements ======================
const tabs = {
  transfer: document.getElementById('tabTransfer'),
  receive: document.getElementById('tabReceive'),
};
const panels = {
  transfer: document.getElementById('transferPanel'),
  receive: document.getElementById('receivePanel'),
};
const transferVideo = document.getElementById('transferVideo');
const transferCanvas = document.getElementById('transferCanvas');
const receiveVideo = document.getElementById('receiveVideo');
const receiveCanvas = document.getElementById('receiveCanvas');
const transferCameraContainer = document.getElementById('transferCameraContainer');
const receiveCameraContainer = document.getElementById('receiveCameraContainer');
const fileInput = document.getElementById('fileInput');
const imagePreview = document.getElementById('imagePreview');
const transferStatus = document.getElementById('transferStatus');
const receiveStatus = document.getElementById('receiveStatus');
const receivedImageContainer = document.getElementById('receivedImageContainer');
const receivedImage = document.getElementById('receivedImage');
const saveImageBtn = document.getElementById('saveImageBtn');
const overlay = document.getElementById('overlay');
const overlayText = document.getElementById('overlayText');
const overlayTimer = document.getElementById('overlayTimer');

const openCameraBtn = document.getElementById('openCameraBtn');
const uploadBtn = document.getElementById('uploadBtn');
const switchCameraTransfer = document.getElementById('switchCameraTransfer');
const switchCameraReceive = document.getElementById('switchCameraReceive');

// ====================== Initialize MediaPipe Hands ======================
async function initMediaPipe() {
  if (mediaPipeReady) return;
  try {
    handsInstance = new Hands({
      locateFile: (file) => {
        return `https://cdn.jsdelivr.net/npm/@mediapipe/hands/${file}`;
      }
    });
    handsInstance.setOptions({
      maxNumHands: 1,
      modelComplexity: 1,
      minDetectionConfidence: 0.5,
      minTrackingConfidence: 0.5
    });
    handsInstance.onResults(onHandResults);
    mediaPipeReady = true;
    console.log('MediaPipe Hands initialized');
  } catch (err) {
    console.error('Failed to initialize MediaPipe:', err);
    showStatus('Gesture engine failed to load.', 'error');
  }
}

// ====================== Mirroring Helper ======================
function applyMirroring() {
  if (videoElement && canvasElement) {
    if (facingMode === 'user') {
      videoElement.style.transform = 'scaleX(-1)';
      canvasElement.style.transform = 'scaleX(-1)';
    } else {
      videoElement.style.transform = '';
      canvasElement.style.transform = '';
    }
  }
}

// ====================== Camera Management ======================
async function startCamera(videoEl, canvasEl) {
  if (cameraStream) {
    stopCamera();
  }
  videoElement = videoEl;
  canvasElement = canvasEl;
  try {
    const constraints = {
      video: {
        facingMode: facingMode,
        width: { ideal: 640 },
        height: { ideal: 480 }
      },
      audio: false
    };
    cameraStream = await navigator.mediaDevices.getUserMedia(constraints);
    videoElement.srcObject = cameraStream;
    await videoElement.play();
    isCameraActive = true;
    videoElement.onloadedmetadata = () => {
      canvasElement.width = videoElement.videoWidth;
      canvasElement.height = videoElement.videoHeight;
      applyMirroring();
      requestAnimationFrame(sendFrames);
    };
    showStatus('Camera active. Show open palm.', 'info');
  } catch (err) {
    console.error('Camera error:', err);
    if (err.name === 'NotAllowedError') {
      showStatus('Camera permission denied. Please allow access.', 'error');
    } else if (err.name === 'NotFoundError') {
      showStatus('No camera found on device.', 'error');
    } else {
      showStatus('Error accessing camera.', 'error');
    }
  }
}

function stopCamera() {
  if (cameraStream) {
    cameraStream.getTracks().forEach(track => track.stop());
    cameraStream = null;
  }
  isCameraActive = false;
  videoElement = null;
  canvasElement = null;
}

async function switchCamera() {
  facingMode = facingMode === 'user' ? 'environment' : 'user';
  if (isCameraActive && videoElement) {
    await startCamera(videoElement, canvasElement);
  }
}

// ====================== MediaPipe Frame Loop ======================
function sendFrames() {
  if (!isCameraActive || !videoElement || !mediaPipeReady || !handsInstance) {
    requestAnimationFrame(sendFrames);
    return;
  }
  handsInstance.send({ image: videoElement }).then(() => {
    requestAnimationFrame(sendFrames);
  }).catch(err => {
    console.error('MediaPipe send error:', err);
    requestAnimationFrame(sendFrames);
  });
}

// ====================== Hand Gesture Math ======================
function isOpenPalm(landmarks) {
  if (!landmarks || landmarks.length < 21) return false;
  const wrist = landmarks[0];
  const middleMcp = landmarks[9];
  const handSize = Math.hypot(middleMcp.x - wrist.x, middleMcp.y - wrist.y);
  if (handSize < 0.05) return false;

  const fingerTips = [4, 8, 12, 16, 20];
  let extendedCount = 0;
  for (const tipIdx of fingerTips) {
    const tip = landmarks[tipIdx];
    const dist = Math.hypot(tip.x - wrist.x, tip.y - wrist.y);
    if (dist > handSize * 1.5) {
      extendedCount++;
    }
  }
  return extendedCount >= 4;
}

function getPalmCenter(landmarks) {
  if (!landmarks || landmarks.length < 21) return null;
  const wrist = landmarks[0];
  const middleMcp = landmarks[9];
  return {
    x: (wrist.x + middleMcp.x) / 2,
    y: (wrist.y + middleMcp.y) / 2,
  };
}

// ====================== Canvas Rendering ======================
function drawHand(landmarks, canvas) {
  const ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, canvas.width, canvas.height);

  if (isTransferring || isReceiving) {
    for (const p of particles) {
      ctx.save();
      ctx.globalAlpha = p.alpha;
      ctx.shadowBlur = 20;
      ctx.shadowColor = p.color;
      ctx.fillStyle = p.color;
      ctx.beginPath();
      ctx.arc(p.x * canvas.width, p.y * canvas.height, 5 * p.scale, 0, 2 * Math.PI);
      ctx.fill();
      ctx.restore();
    }
  }

  if (!landmarks) return;
  ctx.fillStyle = '#00ff00';
  for (const lm of landmarks) {
    ctx.beginPath();
    ctx.arc(lm.x * canvas.width, lm.y * canvas.height, 5, 0, 2 * Math.PI);
    ctx.fill();
  }

  const connections = [
    [0,1],[1,2],[2,3],[3,4],
    [0,5],[5,6],[6,7],[7,8],
    [0,9],[9,10],[10,11],[11,12],
    [0,13],[13,14],[14,15],[15,16],
    [0,17],[17,18],[18,19],[19,20]
  ];
  ctx.strokeStyle = '#00ff00';
  ctx.lineWidth = 2;
  for (const [a,b] of connections) {
    ctx.beginPath();
    ctx.moveTo(landmarks[a].x * canvas.width, landmarks[a].y * canvas.height);
    ctx.lineTo(landmarks[b].x * canvas.width, landmarks[b].y * canvas.height);
    ctx.stroke();
  }
}

// ====================== MediaPipe onResults ======================
function onHandResults(results) {
  if (!canvasElement) return;
  if (results.multiHandLandmarks && results.multiHandLandmarks.length > 0) {
    const landmarks = results.multiHandLandmarks[0];
    drawHand(landmarks, canvasElement);
    const openPalm = isOpenPalm(landmarks);
    lastPalmCenter = getPalmCenter(landmarks);

    if (currentMode === 'transfer' && !isTransferring && openPalm && selectedImageData) {
      startTransferCountdown();
    } else if (currentMode === 'receive' && !isReceiving && openPalm) {
      startReceiveCountdown();
    }
  } else {
    const ctx = canvasElement.getContext('2d');
    ctx.clearRect(0, 0, canvasElement.width, canvasElement.height);
  }
}

// ====================== Countdown Overlay ======================
function showOverlay(text, seconds) {
  overlay.classList.remove('hidden');
  overlayText.textContent = text;
  overlayTimer.textContent = seconds;
  countdownSeconds = seconds;
  countdownInterval = setInterval(() => {
    countdownSeconds--;
    overlayTimer.textContent = countdownSeconds;
    if (countdownSeconds <= 0) {
      clearInterval(countdownInterval);
      countdownInterval = null;
    }
  }, 1000);
}

function hideOverlay() {
  overlay.classList.add('hidden');
  if (countdownInterval) {
    clearInterval(countdownInterval);
    countdownInterval = null;
  }
  clearParticles();
}

// ====================== Transfer Flow ======================
async function startTransferCountdown() {
  if (isTransferring) return;
  isTransferring = true;

  try {
    const response = await fetch('/api/transfer', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ imageData: selectedImageData })
    });
    const data = await response.json();

    if (!response.ok) {
      throw new Error(data.message || 'Transfer failed');
    }

    if (lastPalmCenter) {
      createParticles(lastPalmCenter.x, lastPalmCenter.y, 40);
    }

    showOverlay('Transferring...', 18);
    const transferDuration = 18000;
    setTimeout(() => {
      hideOverlay();
      showStatus('✅ Payload in transit!', 'success');
      isTransferring = false;
    }, transferDuration);

  } catch (err) {
    console.error(err);
    hideOverlay();
    showStatus('❌ Transfer failed: ' + err.message, 'error');
    isTransferring = false;
  }
}

// ====================== Receive Flow ======================
function startReceiveCountdown() {
  if (isReceiving) return;
  isReceiving = true;

  if (lastPalmCenter) {
    createParticles(lastPalmCenter.x, lastPalmCenter.y, 40);
  }

  showOverlay('Receiving...', 18);
  const receiveDuration = 18000;
  let receivedImageData = null;
  let pollInterval = null;

  const finishReceiving = () => {
    hideOverlay();
    isReceiving = false;
    if (pollInterval) clearInterval(pollInterval);
    if (receivedImageData) {
      displayReceivedImage(receivedImageData);
      showStatus('✅ Image received!', 'success');
    } else {
      showStatus('❌ No payload received within time limit.', 'error');
    }
  };

  setTimeout(finishReceiving, receiveDuration);

  const poll = async () => {
    try {
      const response = await fetch('/api/receive');
      if (response.ok) {
        const data = await response.json();
        receivedImageData = data.imageData;
        clearInterval(pollInterval);
        pollInterval = null;
      } else if (response.status === 404) {
        // Still pending
      } else {
        throw new Error('Server error');
      }
    } catch (err) {
      console.error(err);
      clearInterval(pollInterval);
      pollInterval = null;
    }
  };

  poll();
  pollInterval = setInterval(poll, 1000);
}

function displayReceivedImage(base64) {
  receivedImage.src = base64;
  receivedImageContainer.classList.remove('hidden');
  saveImageBtn.href = base64;
}

// ====================== UI Event Handlers ======================
function switchMode(mode) {
  currentMode = mode;
  Object.keys(tabs).forEach(key => {
    tabs[key].classList.toggle('active', key === mode);
    panels[key].classList.toggle('active', key === mode);
  });

  stopCamera();

  if (mode === 'receive') {
    receiveCameraContainer.classList.remove('hidden');
    startCamera(receiveVideo, receiveCanvas);
    showStatus('Show open palm to receive.', 'info');
  } else {
    transferCameraContainer.classList.add('hidden');
    showStatus('Select an image and open camera.', 'info');
  }
}

tabs.transfer.addEventListener('click', () => switchMode('transfer'));
tabs.receive.addEventListener('click', () => switchMode('receive'));

uploadBtn.addEventListener('click', () => fileInput.click());
fileInput.addEventListener('change', (e) => {
  const file = e.target.files[0];
  if (file) {
    const reader = new FileReader();
    reader.onload = (event) => {
      selectedImageData = event.target.result;
      imagePreview.src = selectedImageData;
      imagePreview.classList.remove('hidden');
      showStatus('Image selected. Open camera and show palm.', 'info');
    };
    reader.readAsDataURL(file);
  }
});

openCameraBtn.addEventListener('click', () => {
  transferCameraContainer.classList.remove('hidden');
  startCamera(transferVideo, transferCanvas);
});

switchCameraTransfer.addEventListener('click', switchCamera);
switchCameraReceive.addEventListener('click', switchCamera);

// ====================== Helper: Status Display ======================
function showStatus(message, type = 'info') {
  const el = currentMode === 'transfer' ? transferStatus : receiveStatus;
  el.textContent = message;
  el.style.background = type === 'success' ? '#c6f6d5' :
                         type === 'error' ? '#fed7d7' : '#edf2f7';
}

// ====================== Initialization ======================
async function init() {
  await initMediaPipe();
  switchMode('transfer');
}

init();

