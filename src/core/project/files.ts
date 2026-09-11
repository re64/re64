import type { Project, ProjectFile } from './project.js';
import { derivedId, layerIdOf } from './identity.js';
/** The legacy file key, shared by imports, snapshots, and old operation history. */
export function fileId(name: string): string {
  return derivedId('fil', normalizedFileName(name));
}
/** Alias comparison without turning a filename into an identity. */
export function normalizedFileName(name: string): string {
  return name.replace(/\\/g, '/').split('/').filter(p => p !== '.' && p !== '').join('/');
}
/** A D64 member is a selector within a resource, never part of its identity. */
export function splitFilePath(path: string): {
  name: string;
  member?: string;
} {
  const colon = path.lastIndexOf(':');
  return colon > 0 && path.slice(0, colon).toLowerCase().endsWith('.d64')
    ? { name: path.slice(0, colon), member: path.slice(colon + 1) }
    : { name: path };
}
/** Resolve against the participant's project, before an operation leaves it. */
export function resolveFile(files: readonly ProjectFile[], reference: string): ProjectFile {
  const byId = files.find(f => f.id === reference);
  if (byId)
    return byId;
  const matches = files.filter(f => normalizedFileName(f.name) === normalizedFileName(reference));
  if (matches.length === 1)
    return matches[0];
  if (matches.length > 1)
    throw new Error(`Several files are called "${reference}". Use an id: ${matches.map(f => f.id).join(', ')}.`);
  throw new Error(`This project holds no file called "${reference}". It has: ${files.map(f => `${f.name} (${f.id})`).join(", ")}. describe_project lists its files and ids.`);
}
/**
* Old exports used filenames and sometimes had no file registry at all.
* Preserve those references deterministically. An unrecorded legacy resource
* has no hash/size until a byte-aware import supplies them; never invent content.
* Existing ids (including dangling references) are kept, not re-resolved by name.
*/
export function filesWithIds(project: Project): Project {
  let changed = false;
  const files = (project.files ?? []).map(f => {
    if (f.id)
      return f;
    changed = true;
    return { ...f, id: fileId(f.name) };
  });
  const reference = (name: string): string => {
    if (files.some(f => f.id === name) || /^fil_[a-z0-9]+$/.test(name))
      return name;
    const matches = files.filter(f => normalizedFileName(f.name) === normalizedFileName(name));
    if (matches.length > 1)
      return resolveFile(files, name).id!;
    if (matches.length === 1)
      return matches[0].id!;
    const id = fileId(name);
    files.push({ id, name });
    changed = true;
    return id;
  };
  const layers = project.layers.map((l, i) => {
    if (l.file || !l.path)
      return l;
    const { path, ...rest } = l;
    const { name, member } = splitFilePath(path);
    changed = true;
    // The old id depended on path: persist it before removing that field.
    return { ...rest, id: layerIdOf(l, i), file: reference(name), ...(member === undefined ? {} : { member }) };
  });
  const captures = project.captures?.map(c => {
    const file = reference(c.file);
    if (file === c.file)
      return c;
    changed = true;
    return { ...c, file };
  });
  return changed ? { ...project, layers, ...(files.length ? { files } : {}), ...(captures ? { captures } : {}) } : project;
}
