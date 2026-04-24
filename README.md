# Color Spaces Visualizer (Web + XR)

Interactive Three.js project for visualizing image and video data as:

- a 3D point cloud
- an elevation map surface
- XR (VR/AR) immersive views of the same content

The project uses custom GLSL shaders to convert and display multiple color spaces and to map selected channel values to geometry elevation.

## Implemented Exercises

### point cloud


Implemented features:

- Point-cloud rendering mode from texture pixels.
- Color-space conversion in shader:
	- sRGB
	- HSV
	- CIEXYZ
	- CIExyY
	- CIELAB
	- CIELCH
- Optional additive blending workflow for denser/glow-style point rendering.
- Gaussian blur preprocessing control (applied before point mapping).
- Media input pipeline:
	- default image
	- upload custom image
	- upload video
	- play/pause and +/-10 second controls for video
- 2D media preview panel in the page.
- OrbitControls navigation and axis helpers for scene orientation.

### elevation map


Implemented features:

- Elevation-map mesh mode (plane displaced by sampled channel value).
- Elevation channel selection per color space (e.g. RGB, HSV, XYZ, xyY, Lab, LCh components).
- Elevation scaling control (`Scale Elevation`).
- Color-space conversion and remapping in shader.
- Gaussian blur control affecting displacement source.
- Same image/video upload and playback pipeline as exercise 1.
- 2D preview toggle for input media.
- Directional light used by shader pipeline with manual controlt.

### elevation map with lambertian intensity shading

Implemented features:

- Elevation-map mode with Lambert-style intensity shading enabled.
- Shader normal estimation from local height derivatives for light response.
- Full light control GUI:
	- light position X/Y/Z
	- light intensity
	- light helper toggle
- Elevation scaling and channel controls.
- Color-space switching and elevation remapping.
- Full media pipeline (image + video + uploads + blur).

## XR Versions

### cloud point vr


Implemented features:

- XR point-cloud visualization equivalent to exercise 1.
- Manual XR start buttons for both VR and AR modes.
- Session fallback logic (tries alternative mode if the preferred one fails).
- Controller support with rays and controller models.
- In-world interactive GUI panel rendered as HTMLMesh.
- 3D preview plane for current media texture.

### `exercise2_vr.html`
Loads:

- `script-vr.js?mode=elevationMap&intensity=off&lightControls=off&lightHelper=off`

Implemented features:

- XR elevation-map visualization equivalent to exercise 2.
- Elevation mode world/view offsets for better headset framing.
- Interactive in-world controls for color space, elevation channel, and elevation scale.
- 3D preview plane updates with image/video inputs.

### `exercise3_vr.html`
Loads:

- `script-vr.js?mode=elevationMap&intensity=on&lightX=-1&lightY=0&lightZ=4&lightIntensity=2`

Implemented features:

- XR elevation-map with intensity lighting equivalent to exercise 3.
- In-XR light controls and helper toggle available through interactive panel.
- AR compatibility behavior:
	- transparent clear path for passthrough-capable sessions
	- emulator-safe fallback for opaque blend environments
- World alignment logic to place content in front of the headset and calibrate orientation.


## Run Instructions

### Desktop mode

1. Open any `exercise_*.html` file in your local preview setup (for example VS Code Live Preview).
2. Use the GUI controls to switch color spaces, elevation channels, and media sources.

### XR mode (recommended workflow)

1. Start a local server (for WebXR permissions / device access).
2. Open `exercise1_vr.html`, `exercise2_vr.html`, or `exercise3_vr.html` from the server URL.
3. connect to headset and start a VR or AR session using the in-page buttons.

# color-spaces-visualizer
# color-spaces-visualizer
