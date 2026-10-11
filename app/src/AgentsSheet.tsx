import { ScrollView, StyleSheet, Text, View } from 'react-native';
import type { AgentState, DispatchedAgent } from './api';
import { formatTime } from './format';
import { Sheet } from './Sheet';
import type { Theme } from './theme';

const STATE_LABEL: Record<AgentState, string> = {
  blocked: '等你確認',
  working: '進行中',
  quiet: '一陣子沒動靜',
  done: '完成',
};

export const STATE_COLOR: Record<AgentState, string> = {
  blocked: '#dc2626',
  working: '#d97706',
  quiet: '#9ca3af',
  done: '#16a34a',
};

function minutesAgo(ts: string | null): string {
  if (!ts) return '';
  const minutes = Math.floor((Date.now() - Date.parse(ts)) / 60_000);
  if (Number.isNaN(minutes)) return '';
  return minutes < 1 ? '剛剛' : minutes < 60 ? `${minutes} 分鐘前` : `${Math.floor(minutes / 60)} 小時前`;
}

type Props = { visible: boolean; onClose: () => void; agents: DispatchedAgent[] | null; theme: Theme };

/** What this conversation has sent off: its subagents (and theirs, indented) and coding agents in its space. */
export function AgentsSheet({ visible, onClose, agents, theme }: Props) {
  const going = agents?.filter((a) => a.state !== 'done').length ?? 0;
  return (
    <Sheet visible={visible} onClose={onClose} style={[styles.sheet, { backgroundColor: theme.surface }]}>
      <View style={[styles.handle, { backgroundColor: theme.border }]} />
      <Text style={[styles.title, { color: theme.text }]}>派發中的 agent</Text>
      <Text style={[styles.note, { color: theme.muted }]}>
        {agents == null ? '讀取中…' : agents.length ? `${going} 個還沒結束，列出最近三小時有動靜的` : '最近三小時沒有派出去的 agent'}
      </Text>
      <ScrollView style={styles.list} contentContainerStyle={styles.listContent}>
        {agents?.map((agent) => (
          <View
            key={`${agent.kind}-${agent.id}`}
            style={[
              styles.row,
              { backgroundColor: theme.bg, marginLeft: agent.depth * 18 },
              agent.state === 'done' && styles.dim,
            ]}
          >
            <View style={styles.top}>
              <View style={[styles.dot, { backgroundColor: STATE_COLOR[agent.state] }]} />
              <Text style={[styles.name, { color: theme.text }]} numberOfLines={1}>
                {agent.name}
              </Text>
              <Text style={[styles.state, { color: STATE_COLOR[agent.state] }]}>{STATE_LABEL[agent.state]}</Text>
            </View>
            {!!agent.description && (
              <Text style={[styles.description, { color: theme.text }]} numberOfLines={2}>
                {agent.description}
              </Text>
            )}
            {!!agent.summary && (
              <Text style={[styles.summary, { color: theme.muted }]} numberOfLines={2}>
                {agent.summary}
              </Text>
            )}
            <Text style={[styles.meta, { color: theme.muted }]} numberOfLines={1}>
              {[
                agent.type && agent.type !== agent.name ? agent.type : null,
                agent.started ? `${formatTime(agent.started)} 開始` : null,
                agent.active && agent.state !== 'done' ? `最後動靜 ${minutesAgo(agent.active)}` : null,
              ]
                .filter(Boolean)
                .join(' · ')}
            </Text>
          </View>
        ))}
      </ScrollView>
    </Sheet>
  );
}

const styles = StyleSheet.create({
  sheet: { paddingHorizontal: 16, gap: 6 },
  handle: { alignSelf: 'center', width: 40, height: 5, borderRadius: 3, marginBottom: 6 },
  title: { fontSize: 17, fontWeight: '600' },
  note: { fontSize: 13 },
  list: { maxHeight: 480 },
  listContent: { gap: 8, paddingVertical: 8 },
  row: { borderRadius: 14, paddingHorizontal: 14, paddingVertical: 10, gap: 4 },
  dim: { opacity: 0.6 },
  top: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  dot: { width: 8, height: 8, borderRadius: 4 },
  name: { flex: 1, fontSize: 15, fontWeight: '600' },
  state: { fontSize: 13 },
  description: { fontSize: 14, lineHeight: 20 },
  summary: { fontSize: 13, lineHeight: 18 },
  meta: { fontSize: 12 },
});
