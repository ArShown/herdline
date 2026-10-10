import { Fragment, type ReactNode } from 'react';
import { Linking, Platform, ScrollView, StyleSheet, Text, View } from 'react-native';
import type { Theme } from './theme';

// A small Markdown renderer for chat replies: headings, lists, quotes, code, tables, bold, italics, links.

type Block =
  | { kind: 'code'; text: string }
  | { kind: 'heading'; level: number; text: string }
  | { kind: 'list'; ordered: boolean; items: string[] }
  | { kind: 'quote'; text: string }
  | { kind: 'table'; rows: string[][] }
  | { kind: 'rule' }
  | { kind: 'paragraph'; text: string };

const LIST_ITEM = /^\s*(?:[-*+]|(\d+)[.)])\s+(.*)$/;
const TABLE_DIVIDER = /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/;

function parseBlocks(source: string): Block[] {
  const lines = source.replace(/\r\n/g, '\n').split('\n');
  const blocks: Block[] = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (line.trim().startsWith('```')) {
      const body: string[] = [];
      i++;
      while (i < lines.length && !lines[i].trim().startsWith('```')) body.push(lines[i++]);
      i++;
      blocks.push({ kind: 'code', text: body.join('\n') });
      continue;
    }
    const heading = line.match(/^(#{1,6})\s+(.*)$/);
    if (heading) {
      blocks.push({ kind: 'heading', level: heading[1].length, text: heading[2] });
      i++;
      continue;
    }
    if (/^\s*([-*_])\s*\1\s*\1[\s\-*_]*$/.test(line)) {
      blocks.push({ kind: 'rule' });
      i++;
      continue;
    }
    if (line.includes('|') && i + 1 < lines.length && TABLE_DIVIDER.test(lines[i + 1])) {
      const rows: string[][] = [];
      for (; i < lines.length && lines[i].includes('|'); i++) {
        if (TABLE_DIVIDER.test(lines[i])) continue;
        rows.push(lines[i].trim().replace(/^\||\|$/g, '').split('|').map((c) => c.trim()));
      }
      blocks.push({ kind: 'table', rows });
      continue;
    }
    const item = line.match(LIST_ITEM);
    if (item) {
      const ordered = item[1] !== undefined;
      const items: string[] = [];
      while (i < lines.length && LIST_ITEM.test(lines[i])) {
        items.push(lines[i].match(LIST_ITEM)![2]);
        i++;
        // Indented continuation lines belong to the item above.
        while (i < lines.length && /^\s{2,}\S/.test(lines[i]) && !LIST_ITEM.test(lines[i])) {
          items[items.length - 1] += ' ' + lines[i].trim();
          i++;
        }
      }
      blocks.push({ kind: 'list', ordered, items });
      continue;
    }
    if (line.startsWith('>')) {
      const body: string[] = [];
      while (i < lines.length && lines[i].startsWith('>')) body.push(lines[i++].replace(/^>\s?/, ''));
      blocks.push({ kind: 'quote', text: body.join('\n') });
      continue;
    }
    if (!line.trim()) {
      i++;
      continue;
    }
    const body: string[] = [];
    while (
      i < lines.length &&
      lines[i].trim() &&
      !lines[i].trim().startsWith('```') &&
      !/^#{1,6}\s/.test(lines[i]) &&
      !LIST_ITEM.test(lines[i]) &&
      !lines[i].startsWith('>')
    ) {
      body.push(lines[i++]);
    }
    blocks.push({ kind: 'paragraph', text: body.join('\n') });
  }
  return blocks;
}

const INLINE = /(`[^`]+`|\*\*[^*]+\*\*|__[^_]+__|\*[^*\s][^*]*\*|\[[^\]]+\]\([^)\s]+\))/g;

function inline(text: string, theme: Theme): ReactNode[] {
  return text.split(INLINE).map((part, i) => {
    if (!part) return null;
    if (part.startsWith('`') && part.endsWith('`') && part.length > 1) {
      return (
        <Text key={i} style={[styles.inlineCode, { backgroundColor: theme.code }]}>
          {part.slice(1, -1)}
        </Text>
      );
    }
    if ((part.startsWith('**') || part.startsWith('__')) && part.length > 4) {
      return (
        <Text key={i} style={styles.bold}>
          {part.slice(2, -2)}
        </Text>
      );
    }
    if (part.startsWith('*') && part.endsWith('*') && part.length > 2) {
      return (
        <Text key={i} style={styles.italic}>
          {part.slice(1, -1)}
        </Text>
      );
    }
    const link = part.match(/^\[([^\]]+)\]\(([^)\s]+)\)$/);
    if (link) {
      return (
        <Text key={i} style={{ color: theme.accent }} onPress={() => Linking.openURL(link[2])}>
          {link[1]}
        </Text>
      );
    }
    return <Fragment key={i}>{part}</Fragment>;
  });
}

export function Markdown({ text, theme }: { text: string; theme: Theme }) {
  const base = [styles.body, { color: theme.text }];
  return (
    <View style={styles.wrap}>
      {parseBlocks(text).map((block, i) => {
        switch (block.kind) {
          case 'code':
            return (
              <ScrollView key={i} horizontal style={[styles.codeBlock, { backgroundColor: theme.code }]}>
                <Text selectable style={[styles.mono, { color: theme.text }]}>
                  {block.text}
                </Text>
              </ScrollView>
            );
          case 'heading':
            return (
              <Text key={i} style={[base, styles.heading, { fontSize: block.level <= 2 ? 19 : 17 }]}>
                {inline(block.text, theme)}
              </Text>
            );
          case 'list':
            return (
              <View key={i} style={styles.list}>
                {block.items.map((item, j) => (
                  <View key={j} style={styles.listItem}>
                    <Text style={[base, styles.marker]}>{block.ordered ? `${j + 1}.` : '•'}</Text>
                    <Text selectable style={[base, styles.flex]}>
                      {inline(item, theme)}
                    </Text>
                  </View>
                ))}
              </View>
            );
          case 'quote':
            return (
              <View key={i} style={[styles.quote, { borderColor: theme.border }]}>
                <Text selectable style={[base, { color: theme.muted }]}>
                  {inline(block.text, theme)}
                </Text>
              </View>
            );
          case 'table':
            return (
              <ScrollView key={i} horizontal>
                <View style={[styles.table, { borderColor: theme.border }]}>
                  {block.rows.map((row, r) => (
                    <View key={r} style={[styles.tableRow, { borderColor: theme.border }]}>
                      {row.map((cell, c) => (
                        <Text
                          key={c}
                          selectable
                          style={[base, styles.tableCell, r === 0 && styles.bold, { borderColor: theme.border }]}
                        >
                          {inline(cell, theme)}
                        </Text>
                      ))}
                    </View>
                  ))}
                </View>
              </ScrollView>
            );
          case 'rule':
            return <View key={i} style={[styles.rule, { backgroundColor: theme.border }]} />;
          default:
            return (
              <Text key={i} selectable style={base}>
                {inline(block.text, theme)}
              </Text>
            );
        }
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: 10 },
  body: { fontSize: 16, lineHeight: 24 },
  heading: { fontWeight: '600', lineHeight: 26 },
  bold: { fontWeight: '600' },
  italic: { fontStyle: 'italic' },
  flex: { flex: 1 },
  mono: { fontFamily: Platform.select({ ios: 'Menlo', default: 'monospace' }), fontSize: 13, lineHeight: 19 },
  inlineCode: { fontFamily: Platform.select({ ios: 'Menlo', default: 'monospace' }), fontSize: 14 },
  codeBlock: { borderRadius: 10, padding: 12 },
  list: { gap: 4 },
  listItem: { flexDirection: 'row', gap: 8 },
  marker: { minWidth: 16 },
  quote: { borderLeftWidth: 3, paddingLeft: 10 },
  table: { borderWidth: StyleSheet.hairlineWidth, borderRadius: 6 },
  tableRow: { flexDirection: 'row', borderBottomWidth: StyleSheet.hairlineWidth },
  tableCell: { minWidth: 90, maxWidth: 220, padding: 8, fontSize: 14, lineHeight: 20, borderRightWidth: StyleSheet.hairlineWidth },
  rule: { height: StyleSheet.hairlineWidth, marginVertical: 4 },
});
