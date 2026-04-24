import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { BoxLineGeometry } from 'three/addons/geometries/BoxLineGeometry.js';
import GUI from 'https://cdn.jsdelivr.net/npm/lil-gui@0.19/+esm';
import { HTMLMesh } from 'three/addons/interactive/HTMLMesh.js';
import { InteractiveGroup } from 'three/addons/interactive/InteractiveGroup.js';
import { XRControllerModelFactory } from 'three/addons/webxr/XRControllerModelFactory.js';

let camera, controls, scene, renderer;
let texture, room;
let gui;
let updateDynamicMediaFrame = null;
let _interactiveGUICreated = false;
let xrContentRoot = null;
let _pendingXRWorldAlignment = false;
let _activeXRViewShift = new THREE.Vector3(0, 0, 0);
let _activeXRWorldShift = new THREE.Vector3(0, 0, 0);
let _interactiveGUIMesh = null;
// GUI panel offset applied in elevation mode (x, y, z).
const _activeElevationGUIPanelOffset = new THREE.Vector3();
// Preview plane offset applied in elevation mode (x, y, z).
const _activeElevationPreviewOffset = new THREE.Vector3();

// Uniform world scale used for XR content.
const WORLD_SCALE_FACTOR = 0.4;
// XR world translation shift (x=left, y=up, z=inward).
const XR_WORLD_SHIFT = new THREE.Vector3(1.5, -2.8, 0.6);
// XR view rotation shift (x=pitch, y=yaw, z=roll).
const XR_VIEW_SHIFT = new THREE.Vector3(0.0, 0.0, 0.35);
// Elevation mode XR view rotation shift (x=pitch, y=yaw, z=roll).
const ELEVATION_MODE_XR_VIEW_SHIFT = new THREE.Vector3(0.0, 0.0, 0.9);
// Elevation mode XR world translation shift (x=left, y=up, z=inward).
const ELEVATION_MODE_XR_WORLD_SHIFT = new THREE.Vector3(3.0, -3.3, -1.8);
// Preview plane placement (x, y, z).
const PREVIEW_PLANE_WIDTH = 1.2;
const PREVIEW_PLANE_INITIAL_ASPECT = 16 / 9;
const PREVIEW_PLANE_POSITION = new THREE.Vector3(-2.5, -0.8, 3.8);
// Preview plane rotation offset (x=pitch, y=yaw, z=roll).
const PREVIEW_PLANE_ROTATION_OFFSET = new THREE.Euler(1.5, -0.3, 0, 'XYZ');
// GUI panel base placement (x, y, z).
const GUI_PANEL_POSITION = new THREE.Vector3(-1, 1.0, 1.5);
// Elevation mode GUI panel offset (x, y, z).
const ELEVATION_MODE_GUI_PANEL_POSITION_OFFSET = new THREE.Vector3(-1.5,-0.5, 0.5);
// Elevation mode preview offset (x, y, z).
const ELEVATION_MODE_PREVIEW_POSITION_OFFSET = new THREE.Vector3(0, 1.5, 0.8);
// Calibration position from the emulator/headset overlay (x, y, z).
const VIEWABLE_HEADSET_POSITION = new THREE.Vector3(1.6, 0.93, -5.16);
// Calibration rotation from the emulator/headset overlay (x=pitch, y=yaw, z=roll).
const VIEWABLE_HEADSET_EULER = new THREE.Euler(-3.13, -0.08, 3.11, 'XYZ');
// Desired neutral headset position (x, y, z).
const DESIRED_HEADSET_POSITION = new THREE.Vector3(0, 1.7, 0);
// Desired neutral headset rotation (x=pitch, y=yaw, z=roll).
const DESIRED_HEADSET_EULER = new THREE.Euler(0, 0, 0, 'XYZ');
// Additional XR position offset applied after base calibration (x, y, z).
const XR_POSITION_OFFSET = new THREE.Vector3(-0.32, 1.7, 0.11);
// Additional XR rotation offset applied after base calibration (x=pitch, y=yaw, z=roll).
const XR_ROTATION_OFFSET = new THREE.Euler(-0.12, -0.55, -0.01, 'XYZ');

// Cached XR world transform state.
const _xrWorldTransformState = {
    stored: false,
    position: new THREE.Vector3(),
    quaternion: new THREE.Quaternion(),
    scale: new THREE.Vector3(1, 1, 1)
};

function addToWorld(object3D) {
    if (!object3D) return;
    if (xrContentRoot) {
        xrContentRoot.add(object3D);
    } else if (scene) {
        scene.add(object3D);
    }
}

function alignWorldToXRHeadset() {
    if (!renderer || !camera || !xrContentRoot) return;

    const xrCamera = renderer.xr.getCamera(camera);
    if (!xrCamera) return false;

    if (!_xrWorldTransformState.stored) {
        _xrWorldTransformState.position.copy(xrContentRoot.position);
        _xrWorldTransformState.quaternion.copy(xrContentRoot.quaternion);
        _xrWorldTransformState.scale.copy(xrContentRoot.scale);
        _xrWorldTransformState.stored = true;
    }

    const headsetPosition = new THREE.Vector3();
    const forward = new THREE.Vector3(0, 0, -1);
    xrCamera.getWorldPosition(headsetPosition);
    if (!Number.isFinite(headsetPosition.x) || !Number.isFinite(headsetPosition.y) || !Number.isFinite(headsetPosition.z)) {
        return false;
    }
    forward.applyQuaternion(xrCamera.quaternion);
    forward.y = 0;

    if (forward.lengthSq() < 1e-6) {
        forward.set(0, 0, -1);
    } else {
        forward.normalize();
    }

    const targetPosition = headsetPosition.clone().addScaledVector(forward, 1.5);
    targetPosition.x += _activeXRWorldShift.x;
    targetPosition.y += _activeXRWorldShift.y;
    targetPosition.z += _activeXRWorldShift.z;

    xrContentRoot.position.copy(targetPosition);
    // Convert authored Z-up content to XR Y-up while preserving world scale.
    xrContentRoot.rotation.set(-Math.PI * 0.5, 0, 0);
    xrContentRoot.scale.setScalar(WORLD_SCALE_FACTOR);

    xrContentRoot.rotateX(_activeXRViewShift.x);
    xrContentRoot.rotateY(_activeXRViewShift.y);
    xrContentRoot.rotateZ(_activeXRViewShift.z);

    // Map the user-provided "viewable" headset pose to the desired neutral pose.
    // This keeps the same framing while allowing the user to stand near (0, 1.7, 0).
    const qViewable = new THREE.Quaternion().setFromEuler(VIEWABLE_HEADSET_EULER);
    const qDesired = new THREE.Quaternion().setFromEuler(DESIRED_HEADSET_EULER);
    const mViewable = new THREE.Matrix4().compose(VIEWABLE_HEADSET_POSITION, qViewable, new THREE.Vector3(1, 1, 1));
    const mDesired = new THREE.Matrix4().compose(DESIRED_HEADSET_POSITION, qDesired, new THREE.Vector3(1, 1, 1));
    const calibrationCorrection = mDesired.clone().multiply(mViewable.clone().invert());
    const qOffset = new THREE.Quaternion().setFromEuler(XR_ROTATION_OFFSET);
    const mOffset = new THREE.Matrix4().compose(XR_POSITION_OFFSET, qOffset, new THREE.Vector3(1, 1, 1));
    const finalCorrection = mOffset.multiply(calibrationCorrection);

    xrContentRoot.updateMatrix();
    xrContentRoot.applyMatrix4(finalCorrection);
    xrContentRoot.updateMatrixWorld(true);

    return true;
}

function restoreWorldAfterXRSession() {
    if (!xrContentRoot || !_xrWorldTransformState.stored) return;

    xrContentRoot.position.copy(_xrWorldTransformState.position);
    xrContentRoot.quaternion.copy(_xrWorldTransformState.quaternion);
    xrContentRoot.scale.copy(_xrWorldTransformState.scale);
    _xrWorldTransformState.stored = false;
}

function forceLegacyXRLayerPath() {
    if (typeof XRWebGLBinding === 'undefined' || !XRWebGLBinding?.prototype) {
        return;
    }

    const xrBindingProto = XRWebGLBinding.prototype;
    if (typeof xrBindingProto.createProjectionLayer !== 'function') {
        return;
    }

    try {
        Object.defineProperty(xrBindingProto, 'createProjectionLayer', {
            value: undefined,
            writable: true,
            configurable: true
        });
        console.info('XR compatibility mode enabled: forcing XRWebGLLayer fallback.');
    } catch (error) {
        console.warn('Unable to force XRWebGLLayer fallback:', error);
    }
}

function ensureXRStartButton(buttonType, initialLabel) {
    const selector = `[data-xr-button="${buttonType}"]`;
    let button = document.querySelector(selector);

    if (!button) {
        button = document.createElement('button');
        button.type = 'button';
        button.dataset.xrButton = buttonType;
        button.style.position = 'fixed';
        button.style.left = '20px';
        button.style.bottom = buttonType === 'vr-main' ? '20px' : '78px';
        button.style.width = '160px';
        button.style.padding = '10px 8px';
        button.style.border = '1px solid rgba(255,255,255,0.85)';
        button.style.borderRadius = '6px';
        button.style.background = 'rgba(0,0,0,0.55)';
        button.style.color = '#ffffff';
        button.style.font = '12px monospace';
        button.style.zIndex = '25';
        document.body.appendChild(button);
    }

    if (initialLabel) {
        button.textContent = initialLabel;
    }

    button.title = buttonType === 'vr-main' ? 'Start VR session' : 'Start AR session';
    return button;
}

function setXRStartButtonState(button, { label, enabled, onClick }) {
    if (!button) return;

    button.textContent = label;
    button.style.opacity = enabled ? '1' : '0.6';
    button.style.cursor = enabled ? 'pointer' : 'not-allowed';
    button.style.pointerEvents = enabled ? 'auto' : 'none';
    button.disabled = !enabled;

    button.onclick = enabled
        ? async (event) => {
            event.preventDefault();
            event.stopPropagation();
            await onClick();
        }
        : null;
}

async function isModeSupported(mode) {
    if (!navigator.xr) return false;

    try {
        return await navigator.xr.isSessionSupported(mode);
    } catch {
        return false;
    }
}

async function getXRDiagnostics() {
    const inIframe = window.self !== window.top;
    const secureContext = window.isSecureContext;
    const hasXR = Boolean(navigator.xr);
    const vrSupported = await isModeSupported('immersive-vr');
    const arSupported = await isModeSupported('immersive-ar');

    return {
        inIframe,
        secureContext,
        hasXR,
        vrSupported,
        arSupported
    };
}

function isXRWebGLBindingError(error) {
    return String(error?.message || error).includes('XRWebGLBinding');
}

function disableNativeXRWebGLBindingForPolyfill() {
    if (typeof window.XRWebGLBinding === 'undefined') return false;

    try {
        function XRWebGLBindingStub() {}
        XRWebGLBindingStub.prototype = {};
        window.XRWebGLBinding = XRWebGLBindingStub;
        console.warn('Replaced native XRWebGLBinding with compatibility stub for emulator session retry.');
        return true;
    } catch {
        return false;
    }
}

async function requestXRSession(mode) {
    const arCandidates = [
        {
            optionalFeatures: ['local-floor', 'dom-overlay' ,'camera-access'],
            domOverlay: { root: document.body }
        },
        {
            optionalFeatures: ['local-floor']
        },
        {}
    ];

    const vrCandidates = [
        {
            optionalFeatures: ['local-floor']
        },
        {}
    ];

    const candidates = mode === 'immersive-ar' ? arCandidates : vrCandidates;
    let lastError = null;

    for (const sessionInit of candidates) {
        try {
            return await navigator.xr.requestSession(mode, sessionInit);
        } catch (error) {
            lastError = error;
        }
    }

    throw lastError;
}

async function tryStartXRSession(rendererInstance, mode) {
    if (!navigator.xr) return false;

    try {
        const gl = rendererInstance.getContext();
        if (gl && typeof gl.makeXRCompatible === 'function') {
            try {
                await gl.makeXRCompatible();
            } catch (compatError) {
                console.warn('makeXRCompatible failed, continuing with emulator fallback path:', compatError);
            }
        }

        const session = await requestXRSession(mode);

        try {
            await rendererInstance.xr.setSession(session);
            return true;
        } catch (error) {
            if (!isXRWebGLBindingError(error)) throw error;

            const patched = disableNativeXRWebGLBindingForPolyfill();
            if (!patched) throw error;

            try {
                await session.end();
            } catch {
                // Ignore end failure and try to open a fresh session.
            }

            const retrySession = await requestXRSession(mode);
            await rendererInstance.xr.setSession(retrySession);
            return true;
        }
    } catch (error) {
        console.warn(`Failed to start ${mode} session:`, error);
        return false;
    }
}

async function launchXRWithFallback(rendererInstance, preferredMode, fallbackMode = null) {
    if (rendererInstance.xr.isPresenting) {
        const activeSession = rendererInstance.xr.getSession();
        if (activeSession) {
            await activeSession.end();
        }
        return true;
    }

    let started = await tryStartXRSession(rendererInstance, preferredMode);
    if (!started && fallbackMode) {
        console.info(`Primary mode ${preferredMode} failed. Trying ${fallbackMode}.`);
        started = await tryStartXRSession(rendererInstance, fallbackMode);
    }

    return started;
}

// Shared state so the sessionstart handler knows which mode was actually launched.
let _pendingXRSessionMode = 'immersive-vr';

function setupXRStartButton(rendererInstance) {
    const vrButton = ensureXRStartButton('vr-main', 'ENTER VR');
    const arButton = ensureXRStartButton('ar-main', 'START AR');
    const launchState = { launchInProgress: false };

    const launchMode = async (preferredMode, fallbackMode = null) => {
        if (launchState.launchInProgress) return;

        launchState.launchInProgress = true;
        _pendingXRSessionMode = preferredMode;
        try {
            const started = await launchXRWithFallback(rendererInstance, preferredMode, fallbackMode);
            if (!started) {
                console.warn(`Unable to start XR session for ${preferredMode}.`);
            }
        } finally {
            launchState.launchInProgress = false;
        }
    };

    // Default handlers active immediately; diagnostics may refine labels/mode mapping.
    setXRStartButtonState(vrButton, {
        label: 'ENTER VR',
        enabled: true,
        onClick: async () => launchMode('immersive-vr', 'immersive-ar')
    });
    setXRStartButtonState(arButton, {
        label: 'START AR',
        enabled: true,
        onClick: async () => launchMode('immersive-ar', 'immersive-vr')
    });

    rendererInstance.xr.addEventListener('sessionstart', () => {
        setXRStartButtonState(vrButton, {
            label: 'EXIT XR',
            enabled: true,
            onClick: async () => launchMode('immersive-vr', 'immersive-ar')
        });
    });
    rendererInstance.xr.addEventListener('sessionend', () => {
        setXRStartButtonState(vrButton, {
            label: 'ENTER VR',
            enabled: true,
            onClick: async () => launchMode('immersive-vr', 'immersive-ar')
        });
    });

    getXRDiagnostics().then((diagnostics) => {
        console.info('[XR diagnostics]', diagnostics);

        if (rendererInstance.xr.isPresenting) {
            return;
        }

        // Update VR button
        if (diagnostics.vrSupported) {
            setXRStartButtonState(vrButton, {
                label: 'ENTER VR',
                enabled: true,
                onClick: async () => launchMode('immersive-vr')
            });
        } else if (diagnostics.arSupported) {
            setXRStartButtonState(vrButton, {
                label: 'ENTER XR (AR)',
                enabled: true,
                onClick: async () => launchMode('immersive-ar')
            });
        } else {
            setXRStartButtonState(vrButton, {
                label: 'VR UNSUPPORTED',
                enabled: false,
                onClick: async () => {}
            });
        }

        // Update AR button
        if (diagnostics.arSupported) {
            setXRStartButtonState(arButton, {
                label: 'START AR',
                enabled: true,
                onClick: async () => launchMode('immersive-ar', diagnostics.vrSupported ? 'immersive-vr' : null)
            });
        } else if (diagnostics.vrSupported) {
            setXRStartButtonState(arButton, {
                label: 'ENTER XR (VR)',
                enabled: true,
                onClick: async () => launchMode('immersive-vr')
            });
        } else {
            setXRStartButtonState(arButton, {
                label: 'AR UNSUPPORTED',
                enabled: false,
                onClick: async () => {}
            });
        }
    }).catch((error) => {
        console.warn('XR diagnostics failed:', error);
    });
}

function createInteractiveGUIMesh() {
    if (_interactiveGUICreated) return;
    if (!gui || !renderer || !scene || typeof renderer.xr === 'undefined') return;
    const c1 = renderer.xr.getController(0);
    const c2 = renderer.xr.getController(1);

    const group = new InteractiveGroup();
    // Keep OrbitControls as the only desktop pointer consumer.
    // XR interactions are handled via controller events below.
    if (c1) group.listenToXRControllerEvents(c1);
    if (c2) group.listenToXRControllerEvents(c2);
    addToWorld(group);

    // GUI is already positioned off-screen (fixed, left:-10000px) from creation time,
    // so HTMLMesh can rasterize it. Just ensure pointer events are disabled so it can't
    // accidentally be clicked in 2D.
    gui.domElement.style.pointerEvents = 'auto';

    // Keep desktop orbit controls responsive; the GUI panel is rendered as HTMLMesh,
    // so disabling OrbitControls via DOM pointer events can leave controls stuck off.

    const mesh = new HTMLMesh(gui.domElement);
    
    // place the GUI in front of the camera and scale it to a usable size
    // place the GUI next to the axes and align it parallel to the green +Y arrow
    // ArrowHelpers use +Y for the green axis — rotate the plane so its normal points along +Y
    // position it just beside the Y axis at comfortable height
    mesh.position.copy(GUI_PANEL_POSITION);
    mesh.position.add(_activeElevationGUIPanelOffset);
    // align the plane's +Z (its default normal) to point toward +Y, then flip around Z so the DOM
    // content appears upright (not upside-down).
    mesh.lookAt(mesh.position.clone().add(new THREE.Vector3(0, 1, 0)));

    mesh.rotateY(THREE.MathUtils.degToRad(20));
    mesh.rotateZ(Math.PI);
    mesh.scale.setScalar(6.0);
    group.add(mesh);

    _interactiveGUIMesh = mesh;
    _interactiveGUICreated = true;
}
const scriptQueryParams = new URL(import.meta.url).searchParams;

function getInitialViewMode() {
    const modeFromQuery = scriptQueryParams.get('mode') ?? new URLSearchParams(window.location.search).get('mode');
    if (modeFromQuery === 'elevationMap' || modeFromQuery === 'pointCloud') {
        return modeFromQuery;
    }

    const pageName = window.location.pathname.split('/').pop()?.toLowerCase();
    if (pageName === 'elevationmap.html') {
        return 'elevationMap';
    }

    return 'pointCloud';
}

function isElevationMapMode(viewMode = getInitialViewMode()) {
    return viewMode === 'elevationMap';
}

function isElevationIntensityEnabled() {
    const intensityFromQuery = scriptQueryParams.get('intensity') ?? new URLSearchParams(window.location.search).get('intensity');
    if (intensityFromQuery === 'on') {
        return true;
    }
    if (intensityFromQuery === 'off') {
        return false;
    }

    const pageName = window.location.pathname.split('/').pop()?.toLowerCase();
    if (pageName === 'elevationmap.html') {
        return false;
    }
    if (pageName === 'exercise3.html') {
        return true;
    }

    return true;
}

function getInitialLightSettings() {
    const pageParams = new URLSearchParams(window.location.search);
    const parseNumber = (key, fallback) => {
        const rawValue = scriptQueryParams.get(key) ?? pageParams.get(key);
        if (rawValue === null) {
            return fallback;
        }
        const parsedValue = Number(rawValue);
        return Number.isFinite(parsedValue) ? parsedValue : fallback;
    };

    return {
        x: parseNumber('lightX', -1),
        y: parseNumber('lightY', 0),
        z: parseNumber('lightZ', 4),
        intensity: Math.max(0, parseNumber('lightIntensity', 2))
    };
}

function areLightControlsEnabled() {
    const controlsFromQuery = scriptQueryParams.get('lightControls') ?? new URLSearchParams(window.location.search).get('lightControls');
    if (controlsFromQuery === 'on') {
        return true;
    }
    if (controlsFromQuery === 'off') {
        return false;
    }

    return isElevationMapMode();
}

function isLightHelperEnabled() {
    const helperFromQuery = scriptQueryParams.get('lightHelper') ?? new URLSearchParams(window.location.search).get('lightHelper');
    if (helperFromQuery === 'on') {
        return true;
    }
    if (helperFromQuery === 'off') {
        return false;
    }

    return isElevationMapMode();
}

function isScaleElevationControlEnabled() {
    return isElevationMapMode();
}

function isElevationChannelControlEnabled() {
    return isElevationMapMode();
}

function areAxesHelpersEnabled() {
    return !isElevationMapMode();
}

function isGridBoxEnabled() {
    const pageName = window.location.pathname.split('/').pop()?.toLowerCase();
    return pageName === 'point-cloud.html';
}

function applyElevationModeAdjustments(isElevationMode, previewPlane) {
    _activeXRWorldShift.copy(isElevationMode ? ELEVATION_MODE_XR_WORLD_SHIFT : XR_WORLD_SHIFT);
    _activeXRViewShift.copy(isElevationMode ? ELEVATION_MODE_XR_VIEW_SHIFT : XR_VIEW_SHIFT);

    if (isElevationMode) {
        _activeElevationGUIPanelOffset.copy(ELEVATION_MODE_GUI_PANEL_POSITION_OFFSET);
        _activeElevationPreviewOffset.copy(ELEVATION_MODE_PREVIEW_POSITION_OFFSET);
        previewPlane.position.add(_activeElevationPreviewOffset);
        return;
    }

    _activeElevationGUIPanelOffset.set(0, 0, 0);
    _activeElevationPreviewOffset.set(0, 0, 0);
}

function createBlurredTexture(image, blurRadius = 2) {
    const canvas = document.createElement('canvas');
    canvas.width = image.width;
    canvas.height = image.height;
    const context = canvas.getContext('2d');
    context.filter = `blur(${blurRadius}px)`;
    context.drawImage(image, 0, 0, canvas.width, canvas.height);
    context.filter = 'none';

    const blurredTexture = new THREE.CanvasTexture(canvas);
    blurredTexture.needsUpdate = true;
    return blurredTexture;
}

function createCloudGeometry(imageWidth, imageHeight, discret) {
    const cloudGeometry = new THREE.BufferGeometry();
    const amountX = Math.round(imageWidth / discret);
    const amountY = Math.round(imageHeight / discret);
    const numParticles = amountX * amountY;

    const positions = new Float32Array(numParticles * 3);
    const uvs = new Float32Array(numParticles * 2);
    let i2 = 0;

    for (let ix = 0; ix < amountX; ix++) {
        for (let iy = 0; iy < amountY; iy++) {
            const u = ix / (amountX - 1);
            const v = iy / (amountY - 1);
            uvs[i2] = u;
            uvs[i2 + 1] = v;
            i2 += 2;
        }
    }

    cloudGeometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    cloudGeometry.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
    return cloudGeometry;
}


const COLOR_CONVERSION_GLSL = `
    vec3 sRGBToLinear(vec3 color){
        vec3 linearColor;
        linearColor.r = color.r <= 0.04045 ? color.r / 12.92 : pow((color.r + 0.055) / 1.055, 2.4);
        linearColor.g = color.g <= 0.04045 ? color.g / 12.92 : pow((color.g + 0.055) / 1.055, 2.4);
        linearColor.b = color.b <= 0.04045 ? color.b / 12.92 : pow((color.b + 0.055) / 1.055, 2.4);
        return linearColor;
    }

    vec3 sRGBToCIEXYZ(vec3 color){
        vec3 linearColor = sRGBToLinear(color);
        mat3 sRGBToXYZ = mat3(
            0.4124564, 0.3575761, 0.1804375,
            0.2126729, 0.7151522, 0.0721750,
            0.0193339, 0.1191920, 0.9503041
        );
        return sRGBToXYZ * linearColor;
    }

    vec3 sRGBToCIExyY(vec3 color){
        vec3 XYZ = sRGBToCIEXYZ(color);
        float sum = XYZ.x + XYZ.y + XYZ.z;
        float x = XYZ.x / sum;
        float y = XYZ.y / sum;
        float Y = XYZ.y;
        return vec3(x, y, Y);
    }

    float f(float t) {
        float delta = 6.0/29.0;
        return t < pow(delta, 3.0) ? t / (3.0 * delta * delta) + 4.0/29.0 : pow(t, 1.0/3.0);
    }

    vec3 sRGBToCIELab(vec3 color){
        vec3 XYZ = sRGBToCIEXYZ(color);
        vec3 whitePoint = vec3(0.95047, 1.0, 1.08883);
        float L = 116.0 * f(XYZ.y / whitePoint.y) - 16.0;
        float a = 500.0 * (f(XYZ.x / whitePoint.x) - f(XYZ.y / whitePoint.y));
        float b = 200.0 * (f(XYZ.y / whitePoint.y) - f(XYZ.z / whitePoint.z));
        return vec3(L, a, b);
    }

    vec3 sRGBToCIELCH(vec3 color){
        vec3 Lab = sRGBToCIELab(color);
        float C = length(Lab.yz);
        float h = atan(Lab.z, Lab.y);
        return vec3(Lab.x, C, h);
    }

    vec3 sRGBtoHSV(vec3 color) {
        float cmax = max(color.r, max(color.g, color.b));
        if (cmax == 0.0) {
            return vec3(0.0, 0.0, 0.0);
        }

        float cmin = min(color.r, min(color.g, color.b));
        float delta = cmax - cmin;
        float V = cmax;
        float S = delta / cmax;

        float H;
        if (delta == 0.0) {
            H = 0.0;
        } else if (cmax == color.r) {
            H = mod(60.0 * (color.g - color.b) / delta, 360.0);
        } else if (cmax == color.g) {
            H = mod(60.0 * ((color.b - color.r) / delta + 2.0), 360.0);
        } else {
            H = mod(60.0 * ((color.r - color.g) / delta + 4.0), 360.0);
        }

        return vec3(H / 360.0, S, V);
    }
`;

const APPLY_COLOR_SPACE_GLSL = `
    if (colorSpace == 1) {
        finalColor = sRGBtoHSV(color);
    } else if (colorSpace == 2) {
        finalColor = sRGBToCIEXYZ(color);
    } else if (colorSpace == 3) {
        finalColor = sRGBToCIExyY(color);
    } else if (colorSpace == 4) {
        finalColor = sRGBToCIELab(color);
        finalColor.x /= 100.0;
        finalColor.y = (finalColor.y + 128.0) / 255.0;
        finalColor.z = (finalColor.z + 128.0) / 255.0;
    } else if (colorSpace == 5) {
        vec3 lch = sRGBToCIELCH(color);
        finalColor = lch;
        finalColor.x /= 100.0;
        finalColor.y /= 100.0;
        finalColor.z /= 360.0;
    }
`;

function viewing(point_cloud = true){
    if (point_cloud) {
        return `
            varying vec2 vUv;
            varying vec3 vColor;
            uniform float scaleElevation;
            uniform sampler2D tex;
            uniform float heightOffset;
            uniform int colorSpace;

            ${COLOR_CONVERSION_GLSL}

            void main() {
                vUv = uv;
                vec3 color = texture2D ( tex, vUv ).rgb;
                vec3 finalColor = color;
                ${APPLY_COLOR_SPACE_GLSL}

                vColor = color;

                vec3 mapped = (finalColor * scaleElevation);
                mapped.z += heightOffset;
                float cameraDistance = length(cameraPosition - (modelMatrix * vec4(vec3(0.0), 1.0)).xyz);
                gl_PointSize = (1.5) * (10.0 / cameraDistance);
                gl_Position = projectionMatrix * modelViewMatrix * vec4(mapped, 1.0);
            }
        `;
    }

    return `
        varying vec2 vUv;
        uniform float scaleElevation;
        uniform sampler2D tex;
        uniform float heightOffset;
        uniform int colorSpace;
        uniform vec2 eta;
        uniform int elevationChannel;
        uniform int useIntensity;
        uniform vec3 ligtDir;
        uniform vec3 lightIntensity;
        varying vec3 intensity;
        

        // adding the light source for the lambertian model 
        float kd  = 0.8; // diffuse coefficient

        // ambient terms 
        vec3 Ia = vec3(0.2); // ambient light intensity
        vec3 Ka = vec3(1.0); // ambient reflection coefficient
    

        ${COLOR_CONVERSION_GLSL}

        float selectComponent(vec3 value) {
            if (elevationChannel == 0) {
                return value.x;
            }
            if (elevationChannel == 1) {
                return value.y;
            }
            return value.z;
        }

        float getElevation(vec2 sampleUv) {
            vec3 sampleColor = texture2D(tex, sampleUv).rgb;
            if (colorSpace == 1) {
                return selectComponent(sRGBtoHSV(sampleColor));
            } else if (colorSpace == 2) {
                return selectComponent(sRGBToCIEXYZ(sampleColor));
            } else if (colorSpace == 3) {
                return selectComponent(sRGBToCIExyY(sampleColor));
            } else if (colorSpace == 4) {
                vec3 lab = sRGBToCIELab(sampleColor);
                if (elevationChannel == 0) {
                    return lab.x / 100.0;
                }
                if (elevationChannel == 1) {
                    return (lab.y + 128.0) / 255.0;
                }
                return (lab.z + 128.0) / 255.0;
            } else if (colorSpace == 5) {
                vec3 lch = sRGBToCIELCH(sampleColor);
                if (elevationChannel == 0) {
                    return lch.x / 100.0;
                }
                if (elevationChannel == 1) {
                    return lch.y / 100.0;
                }
                return (lch.z + 3.14159265) / 6.28318530;
            }
            return selectComponent(sampleColor);
        }

        void main() {
            vUv = uv;
            vec3 color = texture2D ( tex, vUv ).rgb;
            vec3 finalColor = color;
            float elevation = getElevation(vUv);

            if (colorSpace == 1) {
                finalColor = sRGBtoHSV(color);
            } else if (colorSpace == 2) {
                finalColor = sRGBToCIEXYZ(color);
            } else if (colorSpace == 3) {
                finalColor = sRGBToCIExyY(color);
            } else if (colorSpace == 4) {
                finalColor = sRGBToCIELab(color);
            } else if (colorSpace == 5) {
                finalColor = sRGBToCIELCH(color);
            }

            vec3 tmp = position;
            tmp.z += elevation * scaleElevation + heightOffset;

            intensity = vec3(1.0);
            if (useIntensity == 1) {
                vec3 L = normalize(ligtDir);  // unit vector from surface point to light source

                float dhdu = (getElevation(vUv + vec2(eta.x, 0.0)) - getElevation(vUv - vec2(eta.x, 0.0))) / (2.0 * eta.x);
                float dhdv = (getElevation(vUv + vec2(0.0, eta.y)) - getElevation(vUv - vec2(0.0, eta.y))) / (2.0 * eta.y);
                vec3 N = normalize(vec3(-dhdu, -dhdv, 1.0)); // normal vector

                float NdotL = max(dot(N, L), 0.0);
                vec3 diffuse = Ia * Ka + lightIntensity * kd * NdotL;
                intensity = diffuse;
            }

            gl_Position = projectionMatrix * modelViewMatrix * vec4(tmp, 1.0);
        }
    `;
}

function viewingShadowPoints() {
    return `
        uniform float scaleElevation;
        uniform sampler2D tex;
        uniform int colorSpace;

        ${COLOR_CONVERSION_GLSL}

        void main() {
            vec3 color = texture2D(tex, uv).rgb;
            vec3 finalColor = color;
            ${APPLY_COLOR_SPACE_GLSL}

            vec3 mapped = (finalColor * scaleElevation);
            mapped.z = 0.0;

            float cameraDistance = length(cameraPosition - (modelMatrix * vec4(vec3(0.0), 1.0)).xyz);
            gl_PointSize = (1.4) * (10.0 / cameraDistance);
            gl_Position = projectionMatrix * modelViewMatrix * vec4(mapped, 1.0);
        }
    `;
}


init();

function init() {
    console.log ( THREE.REVISION );
    forceLegacyXRLayerPath();
    scene = new THREE.Scene();
    scene.background = new THREE.Color( 0x333333 );
    xrContentRoot = new THREE.Group();
    xrContentRoot.scale.setScalar(WORLD_SCALE_FACTOR);
    scene.add(xrContentRoot);

    camera = new THREE.PerspectiveCamera( 60, window.innerWidth / window.innerHeight, 0.1, 199 );
    camera.position.set( 2, 8, 2 );
    camera.up.set( 0, 0, 1 );
    const initialLightSettings = getInitialLightSettings();

    // adding directional light and its helper
    const directionalLight = new THREE.DirectionalLight(0xffffff, initialLightSettings.intensity);
    directionalLight.position.set(initialLightSettings.x, initialLightSettings.y, initialLightSettings.z);
    addToWorld(directionalLight);

    // directional light helper
    const directionalLightHelper = new THREE.DirectionalLightHelper(directionalLight, 0.5);
    directionalLightHelper.visible = isLightHelperEnabled();
    addToWorld(directionalLightHelper);
    

    // Axes and arrows: X=red, Y=green, Z=blue

    if (areAxesHelpersEnabled()) {
        const origin = new THREE.Vector3(0, 0, 0);
        addToWorld( new THREE.ArrowHelper( new THREE.Vector3( 1, 0, 0 ), origin, 1.5, 0xff0000 ) ); // +X red
        addToWorld( new THREE.ArrowHelper( new THREE.Vector3( 0, 1, 0 ), origin, 1.5, 0x00ff00 ) ); // +Y green
        addToWorld( new THREE.ArrowHelper( new THREE.Vector3( 0, 0, 1 ), origin, 1.5, 0x0000ff ) ); // +Z blue
    }

    if (isGridBoxEnabled()) {
        const boxSize = 3.1;
        room = new THREE.LineSegments(
            new BoxLineGeometry(boxSize, boxSize, boxSize, 12, 12, 12),
            new THREE.LineBasicMaterial({ color: 0x9a9a9a, transparent: true, opacity: 0.08 })
        );
        room.position.set(boxSize * 0.5, boxSize * 0.5, boxSize * 0.5);
        addToWorld(room);
    }

    const loader = new THREE.TextureLoader();
    loader.load( 'grenouille-gaus.jpg', function ( loadedTexture ) 
    {   
        const blurSettings = { radius: 2 };
        let sourceImage = loadedTexture.image;
        let activeMediaType = 'image';
        const video = document.createElement('video');
        video.src = 'video.mp4';
        video.muted = true;
        video.loop = true;
        video.playsInline = true;
        video.autoplay = false;
        let uploadedVideoObjectUrl = null;
        let shouldDisplayVideo = false;
        const videoCanvas = document.createElement('canvas');
        const videoCanvasContext = videoCanvas.getContext('2d');
        let videoCanvasTexture = null;
        let previewImageTexture = null;

        const previewPlaneMaterial = new THREE.MeshBasicMaterial({
            map: null,
            side: THREE.DoubleSide
        });
        const previewPlane = new THREE.Mesh(
            new THREE.PlaneGeometry(PREVIEW_PLANE_WIDTH, PREVIEW_PLANE_WIDTH / PREVIEW_PLANE_INITIAL_ASPECT),
            previewPlaneMaterial
        );
        previewPlane.position.copy(PREVIEW_PLANE_POSITION);
        previewPlane.rotation.copy(PREVIEW_PLANE_ROTATION_OFFSET);
        addToWorld(previewPlane);

        const applyPreviewTexture = (nextTexture, mediaWidth, mediaHeight) => {
            if (!nextTexture || !mediaWidth || !mediaHeight) {
                return;
            }

            nextTexture.minFilter = THREE.LinearFilter;
            nextTexture.magFilter = THREE.LinearFilter;
            previewPlaneMaterial.map = nextTexture;
            previewPlaneMaterial.needsUpdate = true;

            const previewHeight = PREVIEW_PLANE_WIDTH * (mediaHeight / mediaWidth);
            previewPlane.geometry.dispose();
            previewPlane.geometry = new THREE.PlaneGeometry(PREVIEW_PLANE_WIDTH, previewHeight);
        };
        applyPreviewTexture(loadedTexture, loadedTexture.image.width, loadedTexture.image.height);
        previewImageTexture = loadedTexture;
        video.style.width = '100%';
        video.style.height = '100%';
        video.style.objectFit = 'contain';
        texture = createBlurredTexture(sourceImage, blurSettings.radius);
        const isElevationMode = isElevationMapMode();
        applyElevationModeAdjustments(isElevationMode, previewPlane);
        const useElevationIntensity = isElevationIntensityEnabled();
        if (!isElevationMode) {
            const topPointLight = new THREE.PointLight(0xffffff, 1.2, 40);
            topPointLight.position.set(1.5, 1.5, 7.0);
            addToWorld(topPointLight);
        }

        var heightOffset = 0;
        var scaleElevation = 3.0;
        var elevationScale = 1.3;
        var discret = 2;

        console.log ( texture.image.width );
        console.log ( texture.image.height );
        var scale = 4.0;
        var factor = texture.image.height/texture.image.width;

        // change the plane geometry  to particles

        // create the plane geometry in the case of elevation map

        var elevationMaterial = new THREE.ShaderMaterial( {
            vertexShader: viewing(false),
            fragmentShader: `
                varying vec2 vUv;
                uniform float scaleElevation;
                uniform sampler2D tex;
                varying vec3 intensity;
            void main() {
                vec3 color = texture2D ( tex, vUv ).rgb * intensity;
                gl_FragColor = vec4(color, 1.0);
            }
            `,
            uniforms: {
                scaleElevation: { value: elevationScale },
                tex: { value: texture },
                heightOffset: { value: heightOffset },
                colorSpace: { value: 0 },
                elevationChannel: { value: 2 },
                eta: { value: new THREE.Vector2(1.0 / (texture.image.width / discret), 1.0 /( texture.image.height / discret)) },
                useIntensity: { value: useElevationIntensity ? 1 : 0 },
                ligtDir: { value: directionalLight.position.clone() },
                lightIntensity: { value: new THREE.Vector3(initialLightSettings.intensity, initialLightSettings.intensity, initialLightSettings.intensity) }
            }
        } );
        
        var planeGeometry = new THREE.PlaneGeometry( scale, scale*factor, texture.image.width/discret, texture.image.height/discret );
        var plane = new THREE.Mesh( planeGeometry, elevationMaterial);
        plane.material.side = THREE.DoubleSide;
        addToWorld(plane);

        const cloudGeometry = createCloudGeometry(texture.image.width, texture.image.height, discret);

        const cloudMaterial = new THREE.ShaderMaterial( {
            blending: THREE.NormalBlending,
            depthTest: true,
            depthWrite: true,
            vertexShader: viewing()
            ,
            fragmentShader: `
                varying vec2 vUv;
                varying vec3 vColor;
                uniform float opacity;

            void main() {
                gl_FragColor.rgb = vColor;
                gl_FragColor.a = opacity;
            }
            `,
            uniforms: {
                scaleElevation: { value: scaleElevation },
                tex: { value: texture },
                heightOffset: { value: heightOffset },
                colorSpace: { value: 0 },
                opacity: { value: 1.0 }
            }
        } );
        
        const cloud = new THREE.Points( cloudGeometry, cloudMaterial );
        cloud.castShadow = false;
        addToWorld(cloud);
        let cloudDepthMaterial = null;
        let cloudDepthPrepass = null;
        let shadowCloud = null;
        let shadowCloudMaterial = null;

        plane.visible = isElevationMode;
        cloud.visible = !isElevationMode;
        if (!isElevationMode) {
            cloudDepthMaterial = new THREE.ShaderMaterial({
                blending: THREE.NoBlending,
                depthTest: true,
                depthWrite: true,
                colorWrite: false,
                transparent: true,
                vertexShader: viewing(),
                fragmentShader: `
                    void main() {
                        gl_FragColor = vec4(0.0, 0.0, 0.0, 1.0);
                    }
                `,
                uniforms: cloudMaterial.uniforms
            });
            cloudDepthPrepass = new THREE.Points(cloudGeometry, cloudDepthMaterial);
            cloudDepthPrepass.renderOrder = -2;
            cloudDepthPrepass.visible = false;
            addToWorld(cloudDepthPrepass);

            shadowCloudMaterial = new THREE.ShaderMaterial({
                blending: THREE.NormalBlending,
                transparent: true,
                depthTest: true,
                depthWrite: false,
                vertexShader: viewingShadowPoints(),
                fragmentShader: `
                    uniform float opacity;
                    void main() {
                        gl_FragColor = vec4(0.05, 0.05, 0.05, opacity);
                    }
                `,
                uniforms: {
                    scaleElevation: { value: scaleElevation },
                    tex: { value: texture },
                    colorSpace: { value: 0 },
                    opacity: { value: 0.02 }
                }
            });
            shadowCloud = new THREE.Points(cloudGeometry, shadowCloudMaterial);
            shadowCloud.renderOrder = -1;
            addToWorld(shadowCloud);
        }

        // Create GUI
        gui = new GUI();
        // Move the 2D panel off-screen instead of display:none — HTMLMesh explicitly skips
        // any element (and all its children) whose style.display === 'none', so the mesh
        // would render blank. Off-screen keeps the browser painting it so the canvas texture
        // stays live, while the user never sees it in 2D mode.
        gui.domElement.style.position = 'fixed';
        gui.domElement.style.left = '-10000px';
        gui.domElement.style.top = '-10000px';
        gui.domElement.style.pointerEvents = 'none';
        gui.domElement.style.maxHeight = 'none';
        gui.domElement.style.overflow = 'visible';
        
        const colorSpaceSettings = {
            colorSpaceIndex: 0
        };
        const elevationComponentState = {
            value: 2
        };
        const elevationComponentSettings = {
            channel: 2
        };
        let elevationComponentController = null;

        const getCurrentColorSpaceIndex = () => colorSpaceSettings.colorSpaceIndex ?? 0;
        const applyElevationChannelUniform = (spaceIndex) => {
            void spaceIndex;
            const selectedValue = Math.min(2, Math.max(0, Math.round(elevationComponentSettings.channel)));
            elevationComponentState.value = selectedValue;
            elevationMaterial.uniforms.elevationChannel.value = selectedValue;
            if (elevationComponentController && elevationComponentController.getValue() !== selectedValue) {
                elevationComponentController.setValue(selectedValue);
            }
        };
        const buildElevationChannelController = () => {
            if (!isElevationChannelControlEnabled()) {
                return;
            }

            elevationComponentSettings.channel = elevationComponentState.value;
            elevationComponentController = gui.add(elevationComponentSettings, 'channel', 0, 2, 1)
                .name('Elevation Channel')
                .onChange((value) => {
                    const selectedValue = Math.min(2, Math.max(0, Math.round(value)));
                    elevationComponentSettings.channel = selectedValue;
                    elevationComponentState.value = selectedValue;
                    elevationMaterial.uniforms.elevationChannel.value = selectedValue;
                });
        };
        
        gui.add(colorSpaceSettings, 'colorSpaceIndex', 0, 5, 1)
            .name('Color Space (0-5)')
            .onChange((value) => {
                const selectedSpace = Math.min(5, Math.max(0, Math.round(value)));
                colorSpaceSettings.colorSpaceIndex = selectedSpace;
                cloudMaterial.uniforms.colorSpace.value = selectedSpace;
                elevationMaterial.uniforms.colorSpace.value = selectedSpace;
                if (shadowCloudMaterial) {
                    shadowCloudMaterial.uniforms.colorSpace.value = selectedSpace;
                }
                applyElevationChannelUniform(selectedSpace);
            });
        if (isElevationChannelControlEnabled()) {
            buildElevationChannelController();
            applyElevationChannelUniform(getCurrentColorSpaceIndex());
        }

        const elevationSettings = {
            scaleElevation: elevationMaterial.uniforms.scaleElevation.value
        };
        if (isScaleElevationControlEnabled()) {
            gui.add(elevationSettings, 'scaleElevation', 0.0, 5.0, 0.1)
                .name('Scale Elevation')
                .onChange((value) => {
                    elevationMaterial.uniforms.scaleElevation.value = value;
                    cloudMaterial.uniforms.scaleElevation.value = value;
                    if (shadowCloudMaterial) {
                        shadowCloudMaterial.uniforms.scaleElevation.value = value;
                    }
                });
        }
        
        const lightSettings = {
            x: directionalLight.position.x,
            y: directionalLight.position.y,
            z: directionalLight.position.z,
            intensity: initialLightSettings.intensity
        };
        const updateLightSettings = () => {
            directionalLight.position.set(lightSettings.x, lightSettings.y, lightSettings.z);
            directionalLight.intensity = lightSettings.intensity;
            directionalLightHelper.update();
            elevationMaterial.uniforms.ligtDir.value.copy(directionalLight.position);
            elevationMaterial.uniforms.lightIntensity.value.setScalar(lightSettings.intensity);
        };
        if (areLightControlsEnabled()) {
            const lightHelperControls = {
                toggleHelper: () => {
                    directionalLightHelper.visible = !directionalLightHelper.visible;
                }
            };
            const lightFolder = gui.addFolder('Light Source');
            lightFolder.add(lightSettings, 'x', -10, 10, 0.1).name('Position X').onChange(updateLightSettings);
            lightFolder.add(lightSettings, 'y', -10, 10, 0.1).name('Position Y').onChange(updateLightSettings);
            lightFolder.add(lightSettings, 'z', -10, 10, 0.1).name('Position Z').onChange(updateLightSettings);
            lightFolder.add(lightSettings, 'intensity', 0, 10, 0.1).name('Intensity').onChange(updateLightSettings);
            lightFolder.add(lightHelperControls, 'toggleHelper').name('Toggle Helper');
        }
        updateLightSettings();

        gui.add(blurSettings, 'radius', 0, 20, 0.5)
            .name('Gaussian Blur')
            .onChange(() => {
                if (activeMediaType === 'image') {
                    updateDisplayedImage(sourceImage);
                } else if (updateDynamicMediaFrame) {
                    updateDynamicMediaFrame();
                }
            });

        function applyTextureAndResize(nextTexture, mediaWidth, mediaHeight) {
            if (texture && texture !== nextTexture) {
                texture.dispose();
            }
            texture = nextTexture;

            elevationMaterial.uniforms.tex.value = texture;
            cloudMaterial.uniforms.tex.value = texture;
            if (shadowCloudMaterial) shadowCloudMaterial.uniforms.tex.value = texture;
            elevationMaterial.uniforms.eta.value.set(
                1.0 / (mediaWidth / discret),
                1.0 / (mediaHeight / discret)
            );

            const nextFactor = mediaHeight / mediaWidth;
            const nextPlaneGeometry = new THREE.PlaneGeometry(
                scale,
                scale * nextFactor,
                mediaWidth / discret,
                mediaHeight / discret
            );
            plane.geometry.dispose();
            plane.geometry = nextPlaneGeometry;

            const nextCloudGeometry = createCloudGeometry(mediaWidth, mediaHeight, discret);
            const previousCloudGeometry = cloud.geometry;
            cloud.geometry = nextCloudGeometry;
            if (cloudDepthPrepass) {
                cloudDepthPrepass.geometry = nextCloudGeometry;
            }
            if (shadowCloud) {
                shadowCloud.geometry = nextCloudGeometry;
            }
            previousCloudGeometry.dispose();
        }

        function updateDisplayedImage(nextImage) {
            sourceImage = nextImage;
            activeMediaType = 'image';
            shouldDisplayVideo = false;
            updateDynamicMediaFrame = null;
            const blurredTexture = createBlurredTexture(nextImage, blurSettings.radius);
            applyTextureAndResize(blurredTexture, nextImage.width, nextImage.height);
            if (previewImageTexture) {
                applyPreviewTexture(previewImageTexture, nextImage.width, nextImage.height);
            }
            video.pause();
        }

        function updateDisplayedVideo() {
            if (video.videoWidth === 0 || video.videoHeight === 0) {
                return;
            }

            activeMediaType = 'video';
            videoCanvas.width = video.videoWidth;
            videoCanvas.height = video.videoHeight;

            if (videoCanvasTexture) {
                videoCanvasTexture.dispose();
            }
            videoCanvasTexture = new THREE.CanvasTexture(videoCanvas);
            videoCanvasTexture.minFilter = THREE.NearestFilter;
            videoCanvasTexture.magFilter = THREE.NearestFilter;
            videoCanvasTexture.generateMipmaps = false;
            videoCanvasTexture.format = THREE.RGBAFormat;
            applyTextureAndResize(videoCanvasTexture, video.videoWidth, video.videoHeight);
            applyPreviewTexture(videoCanvasTexture, video.videoWidth, video.videoHeight);

            updateDynamicMediaFrame = () => {
                if (video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA) {
                    return;
                }
                videoCanvasContext.filter = `blur(${blurSettings.radius}px)`;
                videoCanvasContext.drawImage(video, 0, 0, videoCanvas.width, videoCanvas.height);
                videoCanvasContext.filter = 'none';
                videoCanvasTexture.needsUpdate = true;
            };
            updateDynamicMediaFrame();
        }

        function playVideo() {
            video.play().catch((error) => {
                console.warn('Video autoplay failed:', error);
            });
        }

        const photoInput = document.createElement('input');
        photoInput.type = 'file';
        photoInput.accept = 'image/*';
        photoInput.style.display = 'none';
        document.body.appendChild(photoInput);

        const videoInput = document.createElement('input');
        videoInput.type = 'file';
        videoInput.accept = 'video/*';
        videoInput.style.display = 'none';
        document.body.appendChild(videoInput);

        photoInput.addEventListener('change', (event) => {
            const file = event.target.files?.[0];
            if (!file) {
                return;
            }
            const objectUrl = URL.createObjectURL(file);
            loader.load(
                objectUrl,
                (uploadedTexture) => {
                    if (previewImageTexture && previewImageTexture !== loadedTexture) {
                        previewImageTexture.dispose();
                    }
                    previewImageTexture = uploadedTexture;
                    updateDisplayedImage(uploadedTexture.image);
                    applyPreviewTexture(uploadedTexture, uploadedTexture.image.width, uploadedTexture.image.height);
                    renderer.render(scene, camera);
                    URL.revokeObjectURL(objectUrl);
                    photoInput.value = '';
                },
                undefined,
                () => {
                    console.error('Failed to load uploaded image.');
                    URL.revokeObjectURL(objectUrl);
                    photoInput.value = '';
                }
            );
        });

        videoInput.addEventListener('change', (event) => {
            const file = event.target.files?.[0];
            if (!file) {
                return;
            }

            if (uploadedVideoObjectUrl) {
                URL.revokeObjectURL(uploadedVideoObjectUrl);
            }

            uploadedVideoObjectUrl = URL.createObjectURL(file);
            shouldDisplayVideo = true;
            video.src = uploadedVideoObjectUrl;
            video.load();
            videoInput.value = '';
        });

        const mediaSettings = {
            show3DPreview: 1,
            pausePlayVideo: () => {
                if (activeMediaType !== 'video') {
                    shouldDisplayVideo = true;
                    updateDisplayedVideo();
                    playVideo();
                    return;
                }

                if (video.paused) {
                    playVideo();
                } else {
                    video.pause();
                }
            },
            add10sec: () => {
                if (!Number.isFinite(video.duration) || video.duration <= 0) {
                    video.currentTime += 10;
                    return;
                }
                video.currentTime = Math.min(video.currentTime + 10, video.duration);
            },
            minus10sec: () => {
                video.currentTime = Math.max(video.currentTime - 10, 0);
            },
            uploadVideo: () => videoInput.click(),
            uploadPhoto: () => photoInput.click()
        };
        gui.add(mediaSettings, 'show3DPreview', 0, 1, 1)
            .name('Show 3D Preview (0/1)')
            .onChange((value) => {
                previewPlane.visible = Math.round(value) === 1;
            });
        gui.add(mediaSettings, 'pausePlayVideo').name('Pause/Play Video');
        gui.add(mediaSettings, 'add10sec').name('+10 seconds');
        gui.add(mediaSettings, 'minus10sec').name('-10 seconds');
        gui.add(mediaSettings, 'uploadVideo').name('Upload Video');
        gui.add(mediaSettings, 'uploadPhoto').name('Upload Photo');

        video.onloadeddata = function () {
            if (!shouldDisplayVideo) {
                return;
            }
            updateDisplayedVideo();
            playVideo();
        };

        if (!isElevationMode) {
            const transparencySettings = {
                enabled: 0,
                additiveOpacity: 0.6
            };
            gui.add(transparencySettings, 'additiveOpacity', 0.05, 1.0, 0.05)
                .name('Additive Opacity')
                .onChange((value) => {
                    if (Math.round(transparencySettings.enabled) === 1) {
                        cloudMaterial.uniforms.opacity.value = value;
                    }
                });

            gui.add(transparencySettings, 'enabled', 0, 1, 1)
                .name('Enable Additive Blending (0/1)')
                .onChange((value) => {
                    if (Math.round(value) === 1) {
                        cloudMaterial.blending = THREE.AdditiveBlending;
                        cloudMaterial.uniforms.opacity.value = transparencySettings.additiveOpacity;
                        cloudMaterial.depthWrite = false;
                        if (cloudDepthPrepass) cloudDepthPrepass.visible = true;
                    } else {
                        cloudMaterial.blending = THREE.NormalBlending;
                        cloudMaterial.uniforms.opacity.value = 1.0;
                        cloudMaterial.depthWrite = true;
                        if (cloudDepthPrepass) cloudDepthPrepass.visible = false;
                    }
                });
         
        }

            // Build the HTMLMesh only after the GUI tree is complete so all controls are captured
            // with the correct panel size (avoids missing buttons/cropped content).
            createInteractiveGUIMesh();
    });


    renderer = new THREE.WebGLRenderer( { antialias: true, alpha: true } );
    renderer.setPixelRatio( window.devicePixelRatio );
    renderer.setSize( window.innerWidth, window.innerHeight );
    renderer.xr.enabled = true;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1;
    document.body.appendChild( renderer.domElement );
    setupXRStartButton(renderer);
    renderer.setAnimationLoop( render );
    
    const geometry = new THREE.BufferGeometry();
    geometry.setFromPoints( [ new THREE.Vector3( 0, 0, 0 ), new THREE.Vector3( 0, 0, - 5 ) ] );

    const controller1 = renderer.xr.getController( 0 );
    controller1.add( new THREE.Line( geometry ) );
    scene.add( controller1 );

    const controller2 = renderer.xr.getController( 1 );
    controller2.add( new THREE.Line( geometry ) );
    scene.add( controller2 );

    
    const controllerModelFactory = new XRControllerModelFactory();

    const controllerGrip1 = renderer.xr.getControllerGrip( 0 );
    controllerGrip1.add( controllerModelFactory.createControllerModel( controllerGrip1 ) );
    scene.add( controllerGrip1 );

    const controllerGrip2 = renderer.xr.getControllerGrip( 1 );
    controllerGrip2.add( controllerModelFactory.createControllerModel( controllerGrip2 ) );
    scene.add( controllerGrip2 );

    // controllers just created — attach the interactive GUI only once a real XR session starts,
    // which guarantees both gui (built inside the async texture callback) and the controllers exist.
    renderer.xr.addEventListener( 'sessionstart', () => {
        _pendingXRWorldAlignment = true;
        createInteractiveGUIMesh();

        // Detect AR vs VR.
        const session = renderer.xr.getSession();
        const blendMode = session?.environmentBlendMode;
        const isARSession = _pendingXRSessionMode === 'immersive-ar'
            || blendMode === 'alpha-blend'
            || blendMode === 'additive';

        if (isARSession) {
            // Only use real passthrough (transparent framebuffer) on actual alpha-blend/additive
            // devices. The Immersive Web Emulator renders an opaque synthetic room as the AR
            // background (blendMode === 'opaque'), so clearing to transparent would wipe the scene.
            // For the emulator we just null the scene background and let it composite normally.
            const isRealPassthrough = blendMode === 'alpha-blend' || blendMode === 'additive';

            if (scene.userData._arOriginalBackground === undefined) {
                scene.userData._arOriginalBackground = scene.background;
            }
            scene.background = null;

            if (isRealPassthrough) {
                renderer.setClearColor(0x000000, 0);
                renderer.autoClearColor = false;
                renderer.userData._arClearFn = () => {
                    const gl = renderer.getContext();
                    gl.clearColor(0, 0, 0, 0);
                    gl.clear(gl.COLOR_BUFFER_BIT);
                };
            }
        }
    } );
    renderer.xr.addEventListener( 'sessionend', () => {
        _pendingXRWorldAlignment = false;
        restoreWorldAfterXRSession();

        // Restore non-AR renderer and scene state.
        scene.background = scene.userData._arOriginalBackground ?? new THREE.Color(0x333333);
        scene.userData._arOriginalBackground = undefined;
        renderer.setClearColor(0x000000, 1);
        renderer.autoClearColor = true;
        renderer.userData._arClearFn = null;
    } );


    // controls
    controls = new OrbitControls( camera, renderer.domElement );

    controls.enableDamping = true; 
    controls.dampingFactor = 0.05;

    controls.screenSpacePanning = true;

    controls.minDistance = 1;
    controls.maxDistance = 50;

    window.addEventListener( 'resize', onWindowResize, false );
    createInteractiveGUIMesh();

}

function onWindowResize() {

    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();

    renderer.setSize( window.innerWidth, window.innerHeight );

}

function render() {
    if (renderer?.xr?.isPresenting && _pendingXRWorldAlignment) {
        const aligned = alignWorldToXRHeadset();
        if (aligned) {
            _pendingXRWorldAlignment = false;
        }
    }

    // In AR mode, clear the framebuffer to transparent each frame so the
    // passthrough camera feed shows through wherever nothing is drawn.
    const arClearFn = renderer?.userData?._arClearFn;
    if (arClearFn) arClearFn();

    if (updateDynamicMediaFrame) {
        updateDynamicMediaFrame();
    }

    if (controls && !renderer.xr.isPresenting) {
        controls.update();
    }

    renderer.render( scene, camera );

}