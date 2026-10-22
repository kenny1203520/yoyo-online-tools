export type IfcGeometryData = { vertices: Float32Array; indices: Uint32Array; transform: number[]; color: { x: number; y: number; z: number; w: number } };
export type IfcComponentData = { id: number; name: string; type: string; floor: string; props: Record<string, string>; geometries: IfcGeometryData[] };
export type IfcReply = { type: "ready" } | { type: "component"; component: IfcComponentData; progress: number } | { type: "done"; floors: string[] } | { type: "error" };
