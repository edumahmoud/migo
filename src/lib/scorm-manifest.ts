// =====================================================
// SCORM imsmanifest.xml parser (pure, no I/O)
// Handles nested organizations, self-closing items, default organization,
// xml:base, item parameters and SCORM 1.2 / 2004 detection.
// =====================================================

import type { ScormVersion } from '@/lib/scorm-types';

export interface ManifestNode {
  /** Item identifier from the manifest (unique inside the organization) */
  identifier: string;
  title: string;
  /** Identifier of the parent item, or null for top-level items */
  parentIdentifier: string | null;
  /** True when the item points to a launchable resource */
  isLeaf: boolean;
  /** Resolved launch path (relative to the package root), '' for folders */
  href: string;
  /** 'sco' | 'asset' for leaves, 'organization' for folders */
  scormType: 'sco' | 'asset' | 'organization';
  orderIndex: number;
}

export interface ParsedScormManifest {
  version: ScormVersion;
  title: string;
  nodes: ManifestNode[];
  entryPoint: string;
  /** Number of launchable items */
  totalLaunchable: number;
}

interface XmlTag {
  name: string;
  attrs: Record<string, string>;
  closing: boolean;
  selfClosing: boolean;
  start: number;
  end: number;
}

function decodeEntities(value: string): string {
  return value
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-fA-F]+);/g, (_, n) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&amp;/g, '&')
    .trim();
}

function parseAttrs(raw: string): Record<string, string> {
  const attrs: Record<string, string> = {};
  const re = /([A-Za-z_][\w:.-]*)\s*=\s*(?:"([^"]*)"|'([^']*)')/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(raw)) !== null) {
    attrs[m[1].toLowerCase()] = decodeEntities(m[2] ?? m[3] ?? '');
  }
  return attrs;
}

/** Strip the namespace prefix: "adlcp:scormType" -> "scormtype" */
function local(name: string): string {
  const idx = name.indexOf(':');
  return (idx >= 0 ? name.slice(idx + 1) : name).toLowerCase();
}

function* tokenize(xml: string): Generator<XmlTag> {
  const re = /<!--[\s\S]*?-->|<!\[CDATA\[[\s\S]*?\]\]>|<\?[\s\S]*?\?>|<!(?!--)[^>]*>|<(\/?)([A-Za-z_][\w:.-]*)((?:[^>"']|"[^"]*"|'[^']*')*?)(\/?)>/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(xml)) !== null) {
    if (!m[2]) continue; // comment, CDATA, declaration
    yield {
      name: m[2],
      attrs: m[1] ? {} : parseAttrs(m[3]),
      closing: m[1] === '/',
      selfClosing: m[4] === '/',
      start: m.index,
      end: m.index + m[0].length,
    };
  }
}

function joinPath(base: string, href: string): string {
  if (!base) return href;
  if (/^[a-z][a-z0-9+.-]*:/i.test(href) || href.startsWith('/')) return href;
  return base.replace(/\/?$/, '/') + href;
}

function detectVersion(xml: string): ScormVersion {
  const schemaVersion = xml.match(/<(?:[\w-]+:)?schemaversion[^>]*>([\s\S]*?)<\/(?:[\w-]+:)?schemaversion>/i);
  const sv = schemaVersion ? schemaVersion[1].trim() : '';
  if (/^1\.2/.test(sv)) return '1.2';
  if (/2004|CAM\s*1\.3|1\.3/i.test(sv)) return '2004';
  if (/adlcp_rootv1p2|adlcp_v1p2|imscp_rootv1p1p2/i.test(xml)) return '1.2';
  if (/adlcp_v1p3|adlseq|adlnav|imsss/i.test(xml)) return '2004';
  return '1.2';
}

export function parseScormManifest(xml: string): ParsedScormManifest {
  const version = detectVersion(xml);

  interface RawItem {
    identifier: string;
    identifierRef: string;
    parameters: string;
    title: string;
    parent: string | null;
    order: number;
  }
  interface RawOrg {
    identifier: string;
    title: string;
    items: RawItem[];
  }
  interface RawResource {
    identifier: string;
    href: string;
    base: string;
    scormType: string;
  }

  const orgs: RawOrg[] = [];
  let defaultOrg = '';
  const resources = new Map<string, RawResource>();
  const manifestBases: string[] = [];
  const resourcesBases: string[] = [];

  // Stack of open elements; items carry a reference to their RawItem
  const stack: Array<{ name: string; item?: RawItem; org?: RawOrg }> = [];
  let currentOrg: RawOrg | null = null;
  let itemCounter = 0;
  let anon = 0;

  const tokens = Array.from(tokenize(xml));
  for (let i = 0; i < tokens.length; i++) {
    const tag = tokens[i];
    const name = local(tag.name);

    if (tag.closing) {
      // Pop to the matching open element (tolerates minor malformations)
      for (let s = stack.length - 1; s >= 0; s--) {
        if (local(stack[s].name) === name) {
          stack.splice(s);
          if (name === 'organization') currentOrg = null;
          break;
        }
      }
      continue;
    }

    if (name === 'manifest' && tag.attrs['xml:base']) manifestBases.push(tag.attrs['xml:base']);
    if (name === 'organizations') {
      defaultOrg = tag.attrs['default'] || '';
    }

    if (name === 'organization') {
      currentOrg = { identifier: tag.attrs['identifier'] || `org_${anon++}`, title: '', items: [] };
      orgs.push(currentOrg);
      if (!tag.selfClosing) stack.push({ name: tag.name, org: currentOrg });
      continue;
    }

    if (name === 'item' && currentOrg) {
      let parent: string | null = null;
      for (let s = stack.length - 1; s >= 0; s--) {
        const it = stack[s].item;
        if (it) {
          parent = it.identifier;
          break;
        }
      }
      const item: RawItem = {
        identifier: tag.attrs['identifier'] || `item_${itemCounter}`,
        identifierRef: tag.attrs['identifierref'] || '',
        parameters: tag.attrs['parameters'] || '',
        title: '',
        parent,
        order: itemCounter++,
      };
      currentOrg.items.push(item);
      if (!tag.selfClosing) stack.push({ name: tag.name, item });
      continue;
    }

    if (name === 'title' && !tag.selfClosing) {
      // Read text up to the closing title tag
      const closeTag = tokens[i + 1];
      const text = closeTag && closeTag.closing && local(closeTag.name) === 'title'
        ? decodeEntities(xml.slice(tag.end, closeTag.start))
        : '';
      const top = stack[stack.length - 1];
      if (top?.item && !top.item.title) top.item.title = text;
      else if (top?.org && !top.org.title) top.org.title = text;
      if (closeTag && closeTag.closing && local(closeTag.name) === 'title') i++;
      continue;
    }

    if (name === 'resources') {
      if (tag.attrs['xml:base']) resourcesBases.push(tag.attrs['xml:base']);
      continue;
    }

    if (name === 'resource') {
      const id = tag.attrs['identifier'];
      if (id) {
        const scormType = (tag.attrs['scormtype'] || '').toLowerCase();
        resources.set(id, {
          identifier: id,
          href: tag.attrs['href'] || '',
          base: tag.attrs['xml:base'] || '',
          scormType: scormType || (tag.attrs['type'] || '').toLowerCase(),
        });
      }
      continue;
    }
  }

  // Pick the default organization (or the first one)
  const org = orgs.find((o) => o.identifier === defaultOrg) || orgs[0];
  const baseRoot = joinPath(manifestBases[0] || '', resourcesBases[0] || '');

  const nodes: ManifestNode[] = [];
  const hasChildren = new Set<string>();
  if (org) for (const it of org.items) if (it.parent) hasChildren.add(it.parent);

  if (org) {
    for (const it of org.items) {
      const res = it.identifierRef ? resources.get(it.identifierRef) : undefined;
      const isLeaf = !!(res && res.href);
      let href = '';
      if (isLeaf && res) {
        href = joinPath(joinPath(baseRoot, res.base), res.href);
        if (it.parameters) {
          const params = it.parameters.replace(/^[?&#]/, '');
          const sep = it.parameters.startsWith('#') ? '#' : href.includes('?') ? '&' : '?';
          href += sep + params;
        }
      }
      const scormType: ManifestNode['scormType'] = !isLeaf
        ? 'organization'
        : res && res.scormType.includes('asset')
          ? 'asset'
          : 'sco';
      nodes.push({
        identifier: it.identifier,
        title: it.title || `Item ${it.order + 1}`,
        parentIdentifier: it.parent,
        isLeaf,
        href,
        scormType,
        orderIndex: nodes.length,
      });
    }
  }

  // Fallback: no usable organization items, expose resources directly
  if (nodes.filter((n) => n.isLeaf).length === 0) {
    nodes.length = 0;
    for (const res of resources.values()) {
      if (!res.href) continue;
      nodes.push({
        identifier: res.identifier,
        title: res.identifier,
        parentIdentifier: null,
        isLeaf: true,
        href: joinPath(joinPath(baseRoot, res.base), res.href),
        scormType: res.scormType.includes('asset') ? 'asset' : 'sco',
        orderIndex: nodes.length,
      });
    }
  }

  const launchable = nodes.filter((n) => n.isLeaf);
  const firstSco = launchable.find((n) => n.scormType === 'sco') || launchable[0];

  return {
    version,
    title: org?.title || '',
    nodes,
    entryPoint: firstSco?.href || '',
    totalLaunchable: launchable.length,
  };
}

/** Build a tree from rows that carry identifier / parent_identifier. Orphans become roots. */
export function buildResourceTree<T extends { identifier: string; parent_identifier?: string | null }>(
  rows: T[],
): Array<T & { children: Array<T & { children: unknown[] }> }> {
  type Node = T & { children: Node[] };
  const byId = new Map<string, Node>();
  for (const r of rows) byId.set(r.identifier, { ...r, children: [] } as Node);
  const roots: Node[] = [];
  for (const r of rows) {
    const node = byId.get(r.identifier)!;
    const parentId = r.parent_identifier || null;
    const parent = parentId && parentId !== r.identifier ? byId.get(parentId) : undefined;
    if (parent && !isAncestor(byId, node, parent)) parent.children.push(node);
    else roots.push(node);
  }
  return roots as Array<T & { children: Array<T & { children: unknown[] }> }>;
}

function isAncestor<T extends { identifier: string; parent_identifier?: string | null }>(
  byId: Map<string, T & { children: unknown[] }>,
  node: T,
  candidate: T,
): boolean {
  // true when `node` is an ancestor of `candidate` (would create a cycle)
  let cur: T | undefined = candidate;
  let guard = 0;
  while (cur && guard++ < 1000) {
    if (cur.identifier === node.identifier) return true;
    cur = cur.parent_identifier ? byId.get(cur.parent_identifier) : undefined;
  }
  return false;
}

/** Flatten a tree depth-first, adding a depth value. */
export function flattenResourceTree<T extends { children?: unknown[] }>(
  roots: T[],
  depth = 0,
): Array<T & { depth: number }> {
  const out: Array<T & { depth: number }> = [];
  for (const r of roots) {
    out.push({ ...r, depth });
    if (r.children && r.children.length) {
      out.push(...flattenResourceTree(r.children as T[], depth + 1));
    }
  }
  return out;
}
