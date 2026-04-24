import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { BoxLineGeometry } from 'three/addons/geometries/BoxLineGeometry.js';
import GUI from 'https://cdn.jsdelivr.net/npm/lil-gui@0.19/+esm';

let camera, controls, scene, renderer;
let texture, room;
let shaderMaterial;
let gui;
let updateDynamicMediaFrame = null;
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

	const pageName = window.location.pathname.split('/').pop()?.toLowerCase();
	return pageName === 'exercise3.html';
}

function isLightHelperEnabled() {
	const helperFromQuery = scriptQueryParams.get('lightHelper') ?? new URLSearchParams(window.location.search).get('lightHelper');
	if (helperFromQuery === 'on') {
		return true;
	}
	if (helperFromQuery === 'off') {
		return false;
	}

	const pageName = window.location.pathname.split('/').pop()?.toLowerCase();
	return pageName === 'exercise3.html';
}

function isScaleElevationControlEnabled() {
	const pageName = window.location.pathname.split('/').pop()?.toLowerCase();
	return pageName === 'elevationmap.html' || pageName === 'exercise3.html';
}

function isElevationChannelControlEnabled() {
	const pageName = window.location.pathname.split('/').pop()?.toLowerCase();
	return pageName === 'elevationmap.html' || pageName === 'exercise3.html';
}

function areAxesHelpersEnabled() {
	const pageName = window.location.pathname.split('/').pop()?.toLowerCase();
	return pageName !== 'elevationmap.html' && pageName !== 'exercise3.html';
}

function isGridBoxEnabled() {
	const pageName = window.location.pathname.split('/').pop()?.toLowerCase();
	return pageName === 'point-cloud.html';
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
animate();

function init() {
	console.log ( THREE.REVISION );
	scene = new THREE.Scene();
	scene.background = new THREE.Color( 0x333333 );

	camera = new THREE.PerspectiveCamera( 60, window.innerWidth / window.innerHeight, 0.1, 199 );
	camera.position.set( 2, 8, 2 );
	camera.up.set( 0, 0, 1 );
	const initialLightSettings = getInitialLightSettings();

	// adding directional light and its helper
	const directionalLight = new THREE.DirectionalLight(0xffffff, initialLightSettings.intensity);
	directionalLight.position.set(initialLightSettings.x, initialLightSettings.y, initialLightSettings.z);
	scene.add(directionalLight);

	// directional light helper
	const directionalLightHelper = new THREE.DirectionalLightHelper(directionalLight, 0.5);
	directionalLightHelper.visible = isLightHelperEnabled();
	scene.add(directionalLightHelper);
	
	

	// Axes and arrows: X=red, Y=green, Z=blue

	if (areAxesHelpersEnabled()) {
		const origin = new THREE.Vector3(0, 0, 0);
		scene.add( new THREE.ArrowHelper( new THREE.Vector3( 1, 0, 0 ), origin, 3, 0xff0000 ) ); // +X red
		scene.add( new THREE.ArrowHelper( new THREE.Vector3( 0, 1, 0 ), origin, 3, 0x00ff00 ) ); // +Y green
		scene.add( new THREE.ArrowHelper( new THREE.Vector3( 0, 0, 1 ), origin, 3, 0x0000ff ) ); // +Z blue
	}

	if (isGridBoxEnabled()) {
		const boxSize = 3.1;
		room = new THREE.LineSegments(
			new BoxLineGeometry(boxSize, boxSize, boxSize, 12, 12, 12),
			new THREE.LineBasicMaterial({ color: 0x9a9a9a, transparent: true, opacity: 0.08 })
		);
		room.position.set(boxSize * 0.5, boxSize * 0.5, boxSize * 0.5);
		scene.add(room);
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
		const previewContainer = document.createElement('div');
		previewContainer.style.position = 'fixed';
		previewContainer.style.right = '16px';
		previewContainer.style.bottom = '16px';
		previewContainer.style.width = '240px';
		previewContainer.style.height = '135px';
		previewContainer.style.zIndex = '20';
		previewContainer.style.border = '1px solid rgba(255, 255, 255, 0.35)';
		previewContainer.style.background = 'rgba(0, 0, 0, 0.55)';
		previewContainer.style.overflow = 'hidden';
		previewContainer.style.borderRadius = '6px';
		const previewImage = document.createElement('img');
		previewImage.style.width = '100%';
		previewImage.style.height = '100%';
		previewImage.style.objectFit = 'contain';
		previewImage.style.display = 'block';
		const previewSnapshotCanvas = document.createElement('canvas');
		const previewSnapshotContext = previewSnapshotCanvas.getContext('2d');
		const setPreviewImage = (imageElement) => {
			if (!previewSnapshotContext) {
				return;
			}
			const imageWidth = imageElement.naturalWidth || imageElement.width;
			const imageHeight = imageElement.naturalHeight || imageElement.height;
			if (!imageWidth || !imageHeight) {
				return;
			}
			previewSnapshotCanvas.width = imageWidth;
			previewSnapshotCanvas.height = imageHeight;
			previewSnapshotContext.filter = `blur(${blurSettings.radius}px)`;
			previewSnapshotContext.drawImage(imageElement, 0, 0, imageWidth, imageHeight);
			previewSnapshotContext.filter = 'none';
			previewImage.src = previewSnapshotCanvas.toDataURL();
		};
		setPreviewImage(sourceImage);
		video.style.width = '100%';
		video.style.height = '100%';
		video.style.objectFit = 'contain';
		video.style.display = 'none';
		previewContainer.appendChild(previewImage);
		previewContainer.appendChild(video);
		document.body.appendChild(previewContainer);
		texture = createBlurredTexture(sourceImage, blurSettings.radius);
		loadedTexture.dispose();
		const viewMode = getInitialViewMode();
		const isElevationMode = viewMode === 'elevationMap';
		const useElevationIntensity = isElevationIntensityEnabled();
		if (!isElevationMode) {
			const topPointLight = new THREE.PointLight(0xffffff, 1.2, 40);
			topPointLight.position.set(1.5, 1.5, 7.0);
			scene.add(topPointLight);
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
		plane.position.z = -1.5;
		plane.rotation.z = Math.PI;
		scene.add(plane);

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
		scene.add(cloud);
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
			scene.add(cloudDepthPrepass);

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
			scene.add(shadowCloud);
		}

		// Create GUI
		gui = new GUI();
		
		const colorSpaceSettings = {
			colorSpace: 'sRGB'
		};
		const colorSpaceMap = {
			'sRGB': 0,
			'HSV': 1,
			'CIEXYZ': 2,
			'CIExyY': 3,
			'CIELAB': 4,
			'CIELCH': 5
		};
		const elevationComponentsByColorSpace = {
			0: [
				{ label: 'R', value: 0 },
				{ label: 'G', value: 1 },
				{ label: 'B', value: 2 }
			],
			1: [
				{ label: 'H', value: 0 },
				{ label: 'S', value: 1 },
				{ label: 'V', value: 2 }
			],
			2: [
				{ label: 'X', value: 0 },
				{ label: 'Y', value: 1 },
				{ label: 'Z', value: 2 }
			],
			3: [
				{ label: 'x', value: 0 },
				{ label: 'y', value: 1 },
				{ label: 'Y', value: 2 }
			],
			4: [
				{ label: 'L*', value: 0 },
				{ label: 'a*', value: 1 },
				{ label: 'b*', value: 2 }
			],
			5: [
				{ label: 'L*', value: 0 },
				{ label: 'C*', value: 1 },
				{ label: 'h', value: 2 }
			]
		};
		const defaultElevationComponentByColorSpace = {
			0: 2,
			1: 2,
			2: 1,
			3: 2,
			4: 0,
			5: 0
		};
		const elevationComponentState = {
			selectedByColorSpace: { ...defaultElevationComponentByColorSpace }
		};
		const elevationComponentSettings = {
			channel: 'B'
		};
		let elevationComponentController = null;

		const getCurrentColorSpaceIndex = () => colorSpaceMap[colorSpaceSettings.colorSpace] ?? 0;
		const getElevationComponentOptions = (spaceIndex) => elevationComponentsByColorSpace[spaceIndex] || elevationComponentsByColorSpace[0];
		const getElevationLabelForValue = (spaceIndex, value) => {
			const match = getElevationComponentOptions(spaceIndex).find((option) => option.value === value);
			return match ? match.label : getElevationComponentOptions(spaceIndex)[0].label;
		};
		const applyElevationChannelUniform = (spaceIndex) => {
			const selectedValue = elevationComponentState.selectedByColorSpace[spaceIndex] ?? defaultElevationComponentByColorSpace[spaceIndex] ?? 0;
			elevationMaterial.uniforms.elevationChannel.value = selectedValue;
			elevationComponentSettings.channel = getElevationLabelForValue(spaceIndex, selectedValue);
			if (elevationComponentController && elevationComponentController.getValue() !== elevationComponentSettings.channel) {
				elevationComponentController.setValue(elevationComponentSettings.channel);
			}
		};
		const getElevationChannelOptionsObject = (spaceIndex) => {
			const optionsObject = {};
			for (const option of getElevationComponentOptions(spaceIndex)) {
				optionsObject[option.label] = option.label;
			}
			return optionsObject;
		};
		const rebuildElevationChannelController = () => {
			if (!isElevationChannelControlEnabled()) {
				return;
			}

			if (elevationComponentController) {
				const spaceIndex = getCurrentColorSpaceIndex();
				elevationComponentController.options(getElevationChannelOptionsObject(spaceIndex));
				elevationComponentSettings.channel = getElevationLabelForValue(spaceIndex, elevationComponentState.selectedByColorSpace[spaceIndex]);
				elevationComponentController.updateDisplay();
				return;
			}

			const spaceIndex = getCurrentColorSpaceIndex();
			const options = getElevationComponentOptions(spaceIndex);
			elevationComponentSettings.channel = getElevationLabelForValue(spaceIndex, elevationComponentState.selectedByColorSpace[spaceIndex]);
			elevationComponentController = gui.add(elevationComponentSettings, 'channel', options.map((option) => option.label))
				.name('Elevation Channel')
				.onChange((label) => {
					const currentSpaceIndex = getCurrentColorSpaceIndex();
					const currentOptions = getElevationComponentOptions(currentSpaceIndex);
					const selectedOption = currentOptions.find((option) => option.label === label);
					if (!selectedOption) {
						return;
					}
					elevationComponentState.selectedByColorSpace[currentSpaceIndex] = selectedOption.value;
					elevationMaterial.uniforms.elevationChannel.value = selectedOption.value;
				});
		};
		
		gui.add(colorSpaceSettings, 'colorSpace', ['sRGB', 'HSV', 'CIEXYZ', 'CIExyY', 'CIELAB', 'CIELCH'])
			.name('Color Space')
			.onChange((value) => {
				const selectedSpace = colorSpaceMap[value] ?? 0;
				cloudMaterial.uniforms.colorSpace.value = selectedSpace;
				elevationMaterial.uniforms.colorSpace.value = selectedSpace;
				if (shadowCloudMaterial) {
					shadowCloudMaterial.uniforms.colorSpace.value = selectedSpace;
				}
				elevationComponentState.selectedByColorSpace[selectedSpace] = elevationComponentState.selectedByColorSpace[selectedSpace] ?? defaultElevationComponentByColorSpace[selectedSpace] ?? 0;
				rebuildElevationChannelController();
				applyElevationChannelUniform(selectedSpace);
			});
		if (isElevationChannelControlEnabled()) {
			rebuildElevationChannelController();
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
			setPreviewImage(nextImage);
			previewImage.style.display = 'block';
			video.style.display = 'none';
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
			previewImage.style.display = 'none';
			video.style.display = 'block';
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
					updateDisplayedImage(uploadedTexture.image);
					uploadedTexture.dispose();
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
			show2DPreview: true,
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
		gui.add(mediaSettings, 'show2DPreview')
			.name('Show 2D Preview')
			.onChange((value) => {
				previewContainer.style.display = value ? 'block' : 'none';
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
				enabled: false,
				additiveOpacity: 0.6
			};
			const additiveOpacityController = gui.add(transparencySettings, 'additiveOpacity', 0.05, 1.0, 0.05)
				.name('Additive Opacity')
				.onChange((value) => {
					if (transparencySettings.enabled) {
						cloudMaterial.uniforms.opacity.value = value;
					}
				});
			additiveOpacityController.hide();

			gui.add(transparencySettings, 'enabled')
				.name('Enable Additive Blending')
				.onChange((value) => {
					if (value) {
						cloudMaterial.blending = THREE.AdditiveBlending;
						cloudMaterial.uniforms.opacity.value = transparencySettings.additiveOpacity;
						cloudMaterial.depthWrite = false;
						if (cloudDepthPrepass) cloudDepthPrepass.visible = true;
						additiveOpacityController.show();
					} else {
						cloudMaterial.blending = THREE.NormalBlending;
						cloudMaterial.uniforms.opacity.value = 1.0;
						cloudMaterial.depthWrite = true;
						if (cloudDepthPrepass) cloudDepthPrepass.visible = false;
						additiveOpacityController.hide();
					}
				});
		}
	});


	renderer = new THREE.WebGLRenderer( { antialias: true } );
	renderer.setPixelRatio( window.devicePixelRatio );
	renderer.setSize( window.innerWidth, window.innerHeight );
	
	document.body.appendChild( renderer.domElement );
	
	// controls
	controls = new OrbitControls( camera, renderer.domElement );

	controls.enableDamping = true; 
	controls.dampingFactor = 0.05;

	controls.screenSpacePanning = true;

	controls.minDistance = 1;
	controls.maxDistance = 50;

	window.addEventListener( 'resize', onWindowResize, false );

}

function onWindowResize() {

	camera.aspect = window.innerWidth / window.innerHeight;
	camera.updateProjectionMatrix();

	renderer.setSize( window.innerWidth, window.innerHeight );

}

function animate() {

	requestAnimationFrame( animate );

	controls.update(); // only required if controls.enableDamping = true, or if controls.autoRotate = true

	render();

}

function render() {
	if (updateDynamicMediaFrame) {
		updateDynamicMediaFrame();
	}

	renderer.render( scene, camera );

}
