#!/usr/bin/env python3
"""Export this project's Claude Code chat and agent transcripts into history/.

  python3 tools/export-history.py [projects-dir]

Writes (overwriting each run):
  history/CHAT.md                     readable main conversation (your messages, Claude's replies,
                                      one line per tool call)
  history/AGENTS.md                   index of every build agent with its task and final report
  history/transcripts/**.jsonl        full transcripts (main session, agents, workflow journals)

Embedded screenshots (base64 image data) are replaced by a size note so the
repository stays small, and anything that looks like an access token or API key
is redacted. The text of every message, tool call and tool result is kept.
"""
import json
import os
import re
import sys

REPO = os.path.abspath(os.path.join(os.path.dirname(__file__), '..'))
SRC = os.path.abspath(sys.argv[1] if len(sys.argv) > 1 else '/root/.claude/projects/-home-user-threadgame')
OUT = os.path.join(REPO, 'history')
MAX_STRING = 200_000

SECRETS = [
    re.compile(r'gh[pousr]_[A-Za-z0-9]{20,}'),
    re.compile(r'github_pat_[A-Za-z0-9_]{20,}'),
    re.compile(r'sk-ant-[A-Za-z0-9_\-]{20,}'),
    re.compile(r'AKIA[0-9A-Z]{16}'),
    re.compile(r'(?i)(authorization|x-api-key|api[_-]?key|token|password|secret)(["\']?\s*[:=]\s*["\']?)(Bearer\s+)?[A-Za-z0-9_\-\.=/+]{16,}'),
    re.compile(r'-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----'),
]
DATA_URI = re.compile(r'data:[a-z]+/[a-z0-9.+-]+;base64,[A-Za-z0-9+/=]{2000,}')


def redact(text):
    text = DATA_URI.sub(lambda m: '[embedded data omitted: %d chars]' % len(m.group(0)), text)
    for pattern in SECRETS:
        if pattern.groups >= 2:
            text = pattern.sub(lambda m: m.group(1) + m.group(2) + '[REDACTED]', text)
        else:
            text = pattern.sub('[REDACTED]', text)
    if len(text) > MAX_STRING:
        text = text[:MAX_STRING] + '\n[... %d more characters omitted ...]' % (len(text) - MAX_STRING)
    return text


def clean(node):
    if isinstance(node, dict):
        if node.get('type') == 'image' and isinstance(node.get('source'), dict):
            data = node['source'].get('data', '')
            return {'type': 'image', 'omitted': 'screenshot/image data omitted (%d base64 chars)' % len(data)}
        return {k: clean(v) for k, v in node.items()}
    if isinstance(node, list):
        return [clean(v) for v in node]
    if isinstance(node, str):
        return redact(node)
    return node


def read_jsonl(path):
    rows = []
    with open(path, encoding='utf-8', errors='replace') as f:
        for line in f:
            line = line.strip()
            if not line:
                continue
            try:
                rows.append(json.loads(line))
            except json.JSONDecodeError:
                rows.append({'unparsed': redact(line)})
    return rows


def write_if_changed(path, text):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    if os.path.exists(path):
        with open(path, encoding='utf-8') as f:
            if f.read() == text:
                return
    with open(path, 'w', encoding='utf-8') as f:
        f.write(text)


def blocks(message):
    content = message.get('content') if isinstance(message, dict) else None
    if isinstance(content, str):
        return [{'type': 'text', 'text': content}]
    return content if isinstance(content, list) else []


def tool_line(block):
    inp = block.get('input') or {}
    desc = inp.get('description') or inp.get('file_path') or inp.get('query') or inp.get('pattern') or inp.get('subject') or ''
    if not desc and 'command' in inp:
        desc = inp['command'][:120]
    return '- _tool %s_: %s' % (block.get('name'), str(desc).replace('\n', ' ')[:200])


def chat_markdown(sessions, title):
    out = ['# %s' % title, '',
           '_Exported by tools/export-history.py. Screenshots are omitted; tool calls are listed by purpose. '
           'Full detail: history/transcripts/._', '']
    for name, rows in sessions:
        out += ['', '# Session %s' % name, '']
        out += chat_rows(rows)
    return '\n'.join(out) + '\n'


def chat_rows(rows):
    out = []
    for row in rows:
        kind = row.get('type')
        msg = row.get('message')
        att = row.get('attachment') or {}
        if att.get('type') == 'queued_command' and isinstance(att.get('prompt'), str) \
                and '<task-notification>' not in att['prompt']:
            # Messages typed while Claude was busy arrive as queued commands, not user rows.
            out += ['---', '', '## You  %s' % row.get('timestamp', ''), '', redact(att['prompt']), '']
        elif kind == 'user' and msg:
            texts = [b.get('text', '') for b in blocks(msg) if b.get('type') == 'text']
            texts = [t for t in texts if t.strip() and not t.lstrip().startswith('<system-reminder>')]
            if texts:
                stamp = row.get('timestamp', '')
                out += ['---', '', '## You  %s' % stamp, '', redact('\n\n'.join(texts)), '']
        elif kind == 'assistant' and msg:
            for b in blocks(msg):
                if b.get('type') == 'text' and b.get('text', '').strip():
                    out += ['**Claude:** ' + redact(b['text']), '']
                elif b.get('type') == 'tool_use':
                    out.append(redact(tool_line(b)))
            out.append('')
    return out


def final_text(rows):
    for row in reversed(rows):
        if row.get('type') == 'assistant':
            texts = [b.get('text', '') for b in blocks(row.get('message') or {}) if b.get('type') == 'text']
            if any(t.strip() for t in texts):
                return redact('\n\n'.join(texts))
    return ''


def main():
    # 1. Copy this machine's transcripts (current session) into history/transcripts/. Earlier sessions'
    #    transcripts already there are kept, so the history accumulates across sessions and containers.
    if os.path.isdir(SRC):
        for dirpath, _, files in os.walk(SRC):
            for name in sorted(files):
                path = os.path.join(dirpath, name)
                rel = os.path.relpath(path, SRC)
                if name.endswith('.jsonl'):
                    rows = read_jsonl(path)
                    cleaned = '\n'.join(json.dumps(clean(r), ensure_ascii=False) for r in rows) + '\n'
                    write_if_changed(os.path.join(OUT, 'transcripts', rel), cleaned)
                elif name.endswith('.meta.json') and name.startswith('agent-'):
                    with open(path, encoding='utf-8', errors='replace') as f:
                        write_if_changed(os.path.join(OUT, 'transcripts', rel), redact(f.read()))
    # 2. Build CHAT.md and AGENTS.md from everything saved so far.
    hist = os.path.join(OUT, 'transcripts')
    sessions, agents = [], []
    for dirpath, _, files in os.walk(hist):
        for name in sorted(files):
            if not name.endswith('.jsonl'):
                continue
            path = os.path.join(dirpath, name)
            rel = os.path.relpath(path, hist)
            if os.path.dirname(path) == hist:
                rows = read_jsonl(path)
                first = next((r.get('timestamp') for r in rows if r.get('timestamp')), '')
                sessions.append((first, name[:-len('.jsonl')], rows))
            elif name.startswith('agent-'):
                rows = read_jsonl(path)
                meta_path = path[:-len('.jsonl')] + '.meta.json'
                meta = {}
                if os.path.exists(meta_path):
                    try:
                        meta = json.load(open(meta_path))
                    except json.JSONDecodeError:
                        pass
                last = next((r.get('timestamp') for r in reversed(rows) if r.get('timestamp')), '')
                agents.append((last, rel, meta.get('description', ''), len(rows), final_text(rows)))
    sessions.sort()
    write_if_changed(os.path.join(OUT, 'CHAT.md'),
                     chat_markdown([(s[1], s[2]) for s in sessions], 'Wishweave Wonders — main chat'))
    lines = ['# Build agents', '', 'Every background/workflow agent that worked on this project, newest last, with its '
             'last message (its report when finished). Full transcripts: history/transcripts/.', '']
    for _, rel, desc, count, text in sorted(agents):
        lines += ['## %s' % (desc or rel), '', '- transcript: `history/transcripts/%s` (%d entries)' % (rel, count), '',
                  text[:6000] or '_(no message yet)_', '']
    write_if_changed(os.path.join(OUT, 'AGENTS.md'), '\n'.join(lines) + '\n')


if __name__ == '__main__':
    main()
