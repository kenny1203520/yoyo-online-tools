import { IfcAPI, IFCBUILDINGSTOREY, IFCRELAGGREGATES, IFCRELCONTAINEDINSPATIALSTRUCTURE } from "web-ifc";
import type { IfcComponentData, IfcReply } from "../lib/ifc-transfer";
const scope = self as unknown as { onmessage: ((event: MessageEvent<ArrayBuffer>) => void) | null; postMessage: (reply: IfcReply, transfer?: Transferable[]) => void };
function label(value: unknown) { return value && typeof value === "object" && "value" in value ? String(value.value ?? "") : String(value ?? ""); }
function references(value: unknown): number[] {
  if (Array.isArray(value)) return value.map((item) => Number(item?.value));
  const vector = value as { size?: () => number; get?: (i: number) => { value: number } } | undefined;
  return vector?.size && vector.get ? Array.from({ length: vector.size() }, (_, index) => vector.get!(index).value) : [];
}
scope.onmessage = async (event) => {
  const api = new IfcAPI();
  let model: number | undefined;
  try {
    api.SetWasmPath("/wasm/", true); await api.Init(undefined, true);
    model = api.OpenModel(new Uint8Array(event.data), { COORDINATE_TO_ORIGIN: true });
    if (model < 0) throw new Error("Invalid model");
    const floors = new Map<number, string>();
    const ids = api.GetLineIDsWithType(model, IFCBUILDINGSTOREY);
    for (let i = 0; i < ids.size(); i++) { const id = ids.get(i); floors.set(id, label(api.GetLine(model, id, false).Name) || `Storey #${id}`); }
    const componentFloor = new Map<number, string>();
    for (const kind of [IFCRELCONTAINEDINSPATIALSTRUCTURE, IFCRELAGGREGATES]) {
      const relations = api.GetLineIDsWithType(model, kind, true);
      for (let i = 0; i < relations.size(); i++) {
        const rel = api.GetLine(model, relations.get(i), false);
        const floor = floors.get((rel.RelatingStructure ?? rel.RelatingObject)?.value);
        if (floor) for (const id of references(rel.RelatedElements ?? rel.RelatedObjects)) componentFloor.set(id, floor);
      }
    }
    let unassigned = false;
    api.StreamAllMeshes(model, (flatMesh, index, total) => {
      const line = api.GetLine(model!, flatMesh.expressID, false);
      const type = api.GetNameFromTypeCode(api.GetLineType(model!, flatMesh.expressID));
      const props: Record<string, string> = {};
      for (const key of ["Name", "Description", "ObjectType", "Tag", "GlobalId"]) if (line?.[key] !== undefined) props[key] = label(line[key]);
      const component: IfcComponentData = { id: flatMesh.expressID, name: label(line?.Name) || `${type} #${flatMesh.expressID}`, type, floor: componentFloor.get(flatMesh.expressID) ?? "", props, geometries: [] };
      if (!component.floor) unassigned = true;
      const transfer: Transferable[] = [];
      for (let i = 0; i < flatMesh.geometries.size(); i++) {
        const placed = flatMesh.geometries.get(i);
        const geometry = api.GetGeometry(model!, placed.geometryExpressID);
        const vertices = api.GetVertexArray(geometry.GetVertexData(), geometry.GetVertexDataSize()).slice();
        const indices = api.GetIndexArray(geometry.GetIndexData(), geometry.GetIndexDataSize()).slice();
        const { x, y, z, w } = placed.color;
        component.geometries.push({ vertices, indices, transform: Array.from(placed.flatTransformation), color: { x, y, z, w } });
        transfer.push(vertices.buffer, indices.buffer); geometry.delete();
      }
      scope.postMessage({ type: "component", component, progress: Math.min(99, Math.round(index / Math.max(1, total) * 100)) }, transfer);
      // Some web-ifc builds expose streamed meshes as plain objects, despite the
      // declaration listing delete(). Geometry handles above still need disposal.
      if (typeof flatMesh.delete === "function") flatMesh.delete();
    });
    scope.postMessage({ type: "done", floors: [...floors.values(), ...(unassigned ? [""] : [])] });
  } catch { scope.postMessage({ type: "error" }); }
  finally { if (model !== undefined && model >= 0) api.CloseModel(model); api.Dispose(); }
};
scope.postMessage({ type: "ready" });
