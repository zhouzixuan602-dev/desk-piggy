// A few bytes of 3D model for the tests: a box 1 wide, 2 tall and 0.5 deep, deliberately
// far from the origin, as a self-contained glTF and as an OBJ.

const BOX = { min: [3, 10, -1], max: [4, 12, -0.5] };

const corners = () => {
  const [x0, y0, z0] = BOX.min;
  const [x1, y1, z1] = BOX.max;
  return [
    [x0, y0, z0], [x1, y0, z0], [x1, y1, z0], [x0, y1, z0],
    [x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1],
  ];
};
const FACES = [
  [0, 2, 1], [0, 3, 2], [4, 5, 6], [4, 6, 7], [0, 1, 5], [0, 5, 4],
  [2, 3, 7], [2, 7, 6], [1, 2, 6], [1, 6, 5], [0, 4, 7], [0, 7, 3],
];

export function tinyGltf() {
  const indices = new Uint16Array(FACES.flat());
  const positions = new Float32Array(corners().flat());
  const bytes = new Uint8Array(indices.byteLength + positions.byteLength);
  bytes.set(new Uint8Array(indices.buffer), 0);
  bytes.set(new Uint8Array(positions.buffer), indices.byteLength);
  return JSON.stringify({
    asset: { version: '2.0', generator: 'desk-piggy tests' },
    scene: 0,
    scenes: [{ nodes: [0] }],
    nodes: [{ mesh: 0, name: 'box' }],
    meshes: [{ primitives: [{ attributes: { POSITION: 1 }, indices: 0, material: 0 }] }],
    materials: [{ pbrMetallicRoughness: { baseColorFactor: [0.15, 0.55, 1, 1], metallicFactor: 0, roughnessFactor: 0.6 } }],
    buffers: [{ byteLength: bytes.byteLength, uri: `data:application/octet-stream;base64,${Buffer.from(bytes).toString('base64')}` }],
    bufferViews: [
      { buffer: 0, byteOffset: 0, byteLength: indices.byteLength, target: 34963 },
      { buffer: 0, byteOffset: indices.byteLength, byteLength: positions.byteLength, target: 34962 },
    ],
    accessors: [
      { bufferView: 0, componentType: 5123, count: indices.length, type: 'SCALAR' },
      { bufferView: 1, componentType: 5126, count: 8, type: 'VEC3', min: BOX.min, max: BOX.max },
    ],
  });
}

export function tinyObj() {
  const lines = ['o box'];
  for (const [x, y, z] of corners()) lines.push(`v ${x} ${y} ${z}`);
  for (const [a, b, c] of FACES) lines.push(`f ${a + 1} ${b + 1} ${c + 1}`);
  return `${lines.join('\n')}\n`;
}

export const dataUrl = (text, type = 'application/octet-stream') => `data:${type};base64,${Buffer.from(text).toString('base64')}`;
