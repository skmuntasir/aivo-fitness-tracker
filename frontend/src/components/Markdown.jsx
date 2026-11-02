import React from 'react';
import './Markdown.css';

// Small, safe markdown renderer for the AI coach (headings, bold/italic/code, lists, tables, rules).
// No HTML is ever injected: everything is built from React elements, and partial text
// (while a reply is still streaming) renders fine.

const INLINE = /(\*\*[^*\n]+\*\*|__[^_\n]+__|`[^`\n]+`|\*[^*\s][^*\n]*\*)/g;

const inline = (text, keyBase = '') => {
  if (!text) return null;
  return text.split(INLINE).map((part, i) => {
    const k = `${keyBase}${i}`;
    if (/^\*\*[^*]+\*\*$/.test(part) || /^__[^_]+__$/.test(part)) return <strong key={k}>{part.slice(2, -2)}</strong>;
    if (/^`[^`]+`$/.test(part)) return <code key={k}>{part.slice(1, -1)}</code>;
    if (/^\*[^*]+\*$/.test(part)) return <em key={k}>{part.slice(1, -1)}</em>;
    return part;
  });
};

const isTableLine = (l) => /^\s*\|.*\|\s*$/.test(l);
const isSep = (l) => /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/.test(l);
const splitRow = (l) => l.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map((c) => c.trim());

function parse(text) {
  const lines = String(text || '').replace(/\r/g, '').split('\n');
  const blocks = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (!line.trim()) { i++; continue; }

    if (/^\s*(-{3,}|\*{3,}|_{3,})\s*$/.test(line)) { blocks.push({ t: 'hr' }); i++; continue; }

    const h = line.match(/^\s*(#{1,4})\s+(.*)$/);
    if (h) { blocks.push({ t: 'h', level: Math.min(h[1].length, 3), text: h[2].replace(/#+\s*$/, '').trim() }); i++; continue; }

    if (isTableLine(line) && i + 1 < lines.length && isSep(lines[i + 1])) {
      const head = splitRow(line);
      const rows = [];
      i += 2;
      while (i < lines.length && isTableLine(lines[i])) { rows.push(splitRow(lines[i])); i++; }
      blocks.push({ t: 'table', head, rows });
      continue;
    }

    if (/^\s*>\s?/.test(line)) {
      const buf = [];
      while (i < lines.length && /^\s*>\s?/.test(lines[i])) { buf.push(lines[i].replace(/^\s*>\s?/, '')); i++; }
      blocks.push({ t: 'quote', text: buf.join(' ') });
      continue;
    }

    const li = (l) => l.match(/^(\s*)([-*•]|\d+[.)])\s+(.*)$/);
    if (li(line)) {
      const items = [];
      const ordered = /\d/.test(li(line)[2]);
      while (i < lines.length && li(lines[i])) {
        const m = li(lines[i]);
        items.push({ depth: m[1].replace(/\t/g, '  ').length >= 2 ? 1 : 0, text: m[3] });
        i++;
      }
      blocks.push({ t: ordered ? 'ol' : 'ul', items });
      continue;
    }

    const buf = [];
    while (i < lines.length && lines[i].trim() && !/^\s*(#{1,4}\s|[-*•]\s|\d+[.)]\s|>|\|)/.test(lines[i]) && !/^\s*(-{3,}|\*{3,})\s*$/.test(lines[i])) { buf.push(lines[i]); i++; }
    if (!buf.length) { buf.push(line); i++; }
    blocks.push({ t: 'p', lines: buf });
  }
  return blocks;
}

// Tables with 3+ columns (e.g. a weekly plan) read much better as one card per row than as a squeezed grid.
function TableBlock({ head, rows }) {
  if (head.length >= 3) {
    return (
      <div className="md-cards">
        {rows.map((r, ri) => (
          <div key={ri} className="md-card">
            <div className="md-card-head">
              <strong>{inline(r[0])}</strong>
              {r[1] && <span className="md-tag">{inline(r[1])}</span>}
            </div>
            {r.slice(2).map((c, ci) => c && (
              <div key={ci} className="md-card-row">
                {head[ci + 2] && r.length > 3 && <small>{inline(head[ci + 2])}</small>}
                <span>{inline(c)}</span>
              </div>
            ))}
          </div>
        ))}
      </div>
    );
  }
  return (
    <div className="md-table-wrap">
      <table className="md-table">
        <thead><tr>{head.map((c, i) => <th key={i}>{inline(c)}</th>)}</tr></thead>
        <tbody>{rows.map((r, ri) => <tr key={ri}>{head.map((_, ci) => <td key={ci}>{inline(r[ci] || '')}</td>)}</tr>)}</tbody>
      </table>
    </div>
  );
}

export default function Markdown({ text }) {
  const blocks = parse(text);
  return (
    <div className="md">
      {blocks.map((b, i) => {
        switch (b.t) {
          case 'h': { const H = `h${b.level + 2}`; return <H key={i} className={`md-h md-h${b.level}`}>{inline(b.text)}</H>; }
          case 'hr': return <hr key={i} className="md-hr" />;
          case 'quote': return <blockquote key={i} className="md-quote">{inline(b.text)}</blockquote>;
          case 'table': return <TableBlock key={i} head={b.head} rows={b.rows} />;
          case 'ul':
          case 'ol': {
            const L = b.t;
            return (
              <L key={i} className="md-list">
                {b.items.map((it, k) => <li key={k} className={it.depth ? 'sub' : ''}>{inline(it.text)}</li>)}
              </L>
            );
          }
          default:
            return <p key={i} className="md-p">{b.lines.map((l, k) => <React.Fragment key={k}>{k > 0 && <br />}{inline(l)}</React.Fragment>)}</p>;
        }
      })}
    </div>
  );
}
