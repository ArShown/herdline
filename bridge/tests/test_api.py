import base64
import hashlib
import json
import os
import tempfile
import time
import unittest
from pathlib import Path

from herdline_bridge import transcripts
from herdline_bridge.api import Api, Binary
from herdline_bridge.config import Config
from herdline_bridge.contacts import record_handoff
from herdline_bridge.herdr import Herdr, HerdrError


def agent(session, workspace, pane, status='idle', kind='claude'):
    return {'agent': kind, 'agent_session': {'value': session}, 'workspace_id': workspace,
            'pane_id': pane, 'agent_status': status, 'terminal_title_stripped': f'title {session}'}


class FakeHerdr(Herdr):
    def __init__(self, agents, workspaces):
        self._agents = agents
        self._workspaces = workspaces
        self.prompts = []
        self.keys = []
        self.blocked = set()
        self.created = []
        self.renamed = []
        self.closed = []
        self.started = []

    def agents(self):
        return self._agents

    def workspaces(self):
        return self._workspaces

    def prompt(self, pane, text):
        if pane in self.blocked:
            raise HerdrError('agent_blocked', 'waiting on a dialog')
        self.prompts.append((pane, text))

    def screen(self, pane, lines=40):
        return f'screen of {pane}'

    def send_keys(self, pane, keys):
        self.keys.append((pane, keys))

    def close_pane(self, pane):
        self.closed.append(('pane', pane))
        self._agents = [a for a in self._agents if a['pane_id'] != pane]

    def close_workspace(self, workspace_id):
        self.closed.append(('space', workspace_id))
        self._agents = [a for a in self._agents if a['workspace_id'] != workspace_id]

    def rename_workspace(self, workspace_id, label):
        self.renamed.append((workspace_id, label))
        for w in self._workspaces:
            if w['workspace_id'] == workspace_id:
                w['label'] = label

    def create_workspace(self, cwd, label, env):
        self.created.append((cwd, label, env))
        return 'w9', 'w9:p1'

    def start_claude(self, name, pane, claude_args):
        self.started.append((name, pane, claude_args))
        return 'idle'


def entry(kind, content, uuid, **extra):
    return json.dumps({'type': kind, 'uuid': uuid, 'timestamp': f'2026-10-10T00:00:{uuid[-2:]}Z',
                       'message': {'content': content}, **extra})


class ApiTest(unittest.TestCase):
    def setUp(self):
        transcripts._paths.clear()
        transcripts._cache.clear()
        self.tmp = tempfile.TemporaryDirectory()
        root = Path(self.tmp.name)
        self.config = Config(config_dirs=[root / 'claude'], context_dir=root / 'ctx',
                             state_dir=root / 'state', aliases={'proj_api': 'API'})
        (root / 'claude/projects/p').mkdir(parents=True)
        self.config.context_dir.mkdir()
        self.config.state_dir.mkdir()
        self.config.token_file.write_text(hashlib.sha256(b'secret').hexdigest())
        self.herdr = FakeHerdr(
            [agent('s-old', 'w1', 'w1:p1'), agent('s-new', 'w1', 'w1:p2', 'working'),
             agent('s-web', 'w2', 'w2:p1', 'blocked'), agent('c-1', 'w1', 'w1:p3', kind='codex')],
            [{'workspace_id': 'w1', 'label': 'proj_api'}, {'workspace_id': 'w2', 'label': 'proj_web'}])
        self.api = Api(self.config, self.herdr)

    def tearDown(self):
        self.tmp.cleanup()

    def write_transcript(self, session, lines, age=0.0):
        path = self.config.config_dirs[0] / 'projects/p' / f'{session}.jsonl'
        path.write_text('\n'.join(lines) + '\n')
        stamp = time.time() - age
        os.utime(path, (stamp, stamp))
        return path

    def test_token(self):
        self.assertTrue(self.api.authorized('Bearer secret'))
        self.assertFalse(self.api.authorized('Bearer wrong'))
        self.assertFalse(self.api.authorized(None))
        self.config.token_file.unlink()
        self.assertFalse(self.api.authorized('Bearer secret'))

    def test_contacts_skip_codex_and_use_alias(self):
        status, body = self.api.handle('GET', '/api/contacts', {}, None)
        self.assertEqual(status, 200)
        self.assertEqual([c['name'] for c in body['contacts']], ['API', 'proj_web'])

    def test_away_flag_follows_the_file(self):
        _, body = self.api.handle('GET', '/api/contacts', {}, None)
        self.assertFalse(body['away'])
        self.config.away_flag = Path(self.tmp.name) / 'away'
        self.config.away_flag.touch()
        _, body = self.api.handle('GET', '/api/contacts', {}, None)
        self.assertTrue(body['away'])

    def test_most_recent_session_is_on_duty(self):
        self.write_transcript('s-old', [entry('user', 'hi', 'u-01')], age=0)
        self.write_transcript('s-new', [entry('user', 'hi', 'u-02')], age=60)
        self.api.handle('POST', '/api/contacts/w1/messages', {}, {'text': 'hello'})
        self.assertEqual(self.herdr.prompts, [('w1:p1', 'hello')])

    def test_handoff_record_overrides_recency(self):
        self.write_transcript('s-old', [entry('user', 'hi', 'u-01')], age=0)
        self.write_transcript('s-new', [entry('user', 'hi', 'u-02')], age=60)
        record_handoff(self.config, 's-old', 's-new')
        self.api.handle('POST', '/api/contacts/w1/messages', {}, {'text': 'hello'})
        self.assertEqual(self.herdr.prompts, [('w1:p2', 'hello')])

    def test_messages_keep_chat_only(self):
        record_handoff(self.config, 's-old', 's-new')
        self.write_transcript('s-new', [
            entry('user', 'question <system-reminder>hidden</system-reminder>', 'u-01'),
            entry('assistant', [{'type': 'text', 'text': 'checking'},
                                {'type': 'tool_use', 'name': 'Bash'}], 'a-02'),
            entry('user', [{'type': 'tool_result', 'content': 'out'}], 'u-03'),
            entry('user', 'meta', 'u-04', isMeta=True),
            entry('user', 'This session is being continued', 'u-07', isCompactSummary=True),
            entry('user', '<command-name>/x</command-name>', 'u-05'),
            'not json',
            entry('assistant', [{'type': 'text', 'text': 'answer'}], 'a-06'),
        ])
        status, body = self.api.handle('GET', '/api/contacts/w1/messages', {}, None)
        self.assertEqual(status, 200)
        self.assertEqual([(m['role'], m['text']) for m in body['messages']],
                         [('user', 'question'), ('assistant', 'checking'), ('assistant', 'answer')])

    def test_scroll_back_pages_through_older_messages(self):
        record_handoff(self.config, 's-old', 's-new')
        self.write_transcript('s-new', [entry('assistant', [{'type': 'text', 'text': f'm{i}'}], f'a-{i:02d}')
                                        for i in range(10)])
        _, latest = self.api.handle('GET', '/api/contacts/w1/messages', {'limit': '4'}, None)
        self.assertEqual([m['text'] for m in latest['messages']], ['m6', 'm7', 'm8', 'm9'])
        self.assertTrue(latest['has_more'])
        _, page = self.api.handle('GET', '/api/contacts/w1/messages', {'limit': '4', 'before': 'a-06'}, None)
        self.assertEqual([m['text'] for m in page['messages']], ['m2', 'm3', 'm4', 'm5'])
        self.assertTrue(page['has_more'])
        _, last = self.api.handle('GET', '/api/contacts/w1/messages', {'limit': '4', 'before': 'a-02'}, None)
        self.assertEqual([m['text'] for m in last['messages']], ['m0', 'm1'])
        self.assertFalse(last['has_more'])
        _, gone = self.api.handle('GET', '/api/contacts/w1/messages', {'before': 'missing'}, None)
        self.assertEqual((gone['messages'], gone['has_more']), ([], False))

    def test_messages_from_other_sessions_are_not_the_person(self):
        record_handoff(self.config, 's-old', 's-new')
        self.write_transcript('s-new', [
            entry('user', 'typed', 'u-01', origin={'kind': 'human'}),
            entry('user', 'Another Claude session sent a message:\n<teammate-message>x', 'u-02'),
            entry('user', 'peer says hi', 'u-03', origin={'kind': 'peer'}),
            entry('user', 'task done', 'u-04', origin={'kind': 'task-notification'}),
            entry('user', '[Request interrupted by user]', 'u-05'),
            entry('user', 'old transcript without origin', 'u-06'),
        ])
        status, body = self.api.handle('GET', '/api/contacts/w1/messages', {}, None)
        self.assertEqual([m['text'] for m in body['messages']], ['typed', 'old transcript without origin'])

    def test_tail_reads_only_the_end_of_big_files(self):
        lines = [entry('assistant', [{'type': 'text', 'text': 'x' * 2000}], f'a-{i:06d}')
                 for i in range(400)]
        path = self.write_transcript('s-web', lines)
        self.assertGreater(path.stat().st_size, transcripts.CHUNK)
        messages = transcripts.tail(path, 3)
        self.assertEqual([m['id'] for m in messages], ['a-000397', 'a-000398', 'a-000399'])

    def test_preview_and_context(self):
        self.write_transcript('s-web', [entry('assistant', [{'type': 'text', 'text': 'done'}], 'a-01')])
        (self.config.context_dir / 's-web.json').write_text('{"used_percentage": 42}')
        web = next(c for c in self.api.list_contacts() if c['id'] == 'w2')
        self.assertEqual(web['preview']['text'], 'done')
        self.assertEqual(web['context_used'], 42)
        self.assertEqual(web['status'], 'blocked')

    def test_blocked_session_rejects_prompt(self):
        self.herdr.blocked.add('w2:p1')
        status, body = self.api.handle('POST', '/api/contacts/w2/messages', {}, {'text': 'hi'})
        self.assertEqual((status, body['error']), (409, 'agent_blocked'))

    def test_keys_whitelist(self):
        status, _ = self.api.handle('POST', '/api/contacts/w2/keys', {}, {'keys': ['1', 'enter']})
        self.assertEqual(status, 200)
        status, _ = self.api.handle('POST', '/api/contacts/w2/keys', {}, {'keys': ['rm -rf']})
        self.assertEqual(status, 400)
        self.assertEqual(self.herdr.keys, [('w2:p1', ['1', 'enter'])])

    def test_empty_text_and_unknown_contact(self):
        self.assertEqual(self.api.handle('POST', '/api/contacts/w2/messages', {}, {'text': ' '})[0], 400)
        self.assertEqual(self.api.handle('GET', '/api/contacts/nope/messages', {}, None)[0], 404)


    def test_create_space_names_itself_and_starts_claude(self):
        self.config.space_cwd = Path(self.tmp.name)
        self.herdr._workspaces.append({'workspace_id': 'w3', 'label': 'Space 1'})
        status, body = self.api.handle('POST', '/api/spaces', {}, None)
        self.assertEqual((status, body['id'], body['name']), (201, 'w9', 'Space 2'))
        self.assertEqual(self.herdr.created[0][:2], (self.tmp.name, 'Space 2'))
        name, pane, args = self.herdr.started[0]
        self.assertTrue(name.startswith('space-2-'))
        self.assertEqual((pane, args), ('w9:p1', ['--permission-mode', 'auto']))

    def test_create_space_uses_account_with_most_quota_left(self):
        self.config.space_cwd = Path(self.tmp.name)
        other = Path(self.tmp.name) / '.claude-b'
        self.config.config_dirs.append(other)
        usage = Path(self.tmp.name) / 'usage'
        usage.mkdir()
        (usage / 'a.json').write_text('{"seven_day": {"used_percentage": 80}}')
        (usage / 'b.json').write_text('{"seven_day": {"used_percentage": 20}}')
        self.config.usage_files = {'claude': usage / 'a.json', 'claude-b': usage / 'b.json'}
        status, body = self.api.handle('POST', '/api/spaces', {}, None)
        self.assertEqual((status, body['account']), (201, 'claude-b'))
        self.assertEqual(self.herdr.created[0][2], {'CLAUDE_CONFIG_DIR': str(other)})

    def test_create_space_falls_back_to_first_account_and_needs_cwd(self):
        self.assertEqual(self.api.handle('POST', '/api/spaces', {}, None)[0], 400)
        self.config.space_cwd = Path(self.tmp.name)
        status, body = self.api.handle('POST', '/api/spaces', {}, None)
        self.assertEqual((status, body['account']), (201, 'claude'))

    def test_auto_named_space_takes_its_task_title(self):
        self.herdr._workspaces.append({'workspace_id': 'w3', 'label': 'Space 1'})
        self.herdr._agents.append(agent('s-3', 'w3', 'w3:p1'))
        self.herdr._agents[-1]['terminal_title_stripped'] = 'Claude Code'
        self.api.list_contacts()
        self.assertEqual(self.herdr.renamed, [])
        self.herdr._agents[-1]['terminal_title_stripped'] = '修登入頁'
        names = {c['id']: c['name'] for c in self.api.list_contacts()}
        self.assertEqual((names['w3'], self.herdr.renamed), ('修登入頁', [('w3', '修登入頁')]))
        # Named spaces keep their name even when the title changes.
        self.herdr._agents[-1]['terminal_title_stripped'] = '別的事'
        self.assertEqual({c['id']: c['name'] for c in self.api.list_contacts()}['w3'], '修登入頁')
        self.assertEqual(len(self.herdr.renamed), 1)


    def test_usage_line_is_cached(self):
        _, body = self.api.handle('GET', '/api/contacts', {}, None)
        self.assertIsNone(body['usage'])
        counter = Path(self.tmp.name) / 'count'
        self.config.usage_command = f"sh -c 'echo x >> {counter}; echo \"A 6% │ B 11%\"'"
        self.assertEqual(self.api.handle('GET', '/api/contacts', {}, None)[1]['usage'], 'A 6% │ B 11%')
        self.api.handle('GET', '/api/contacts', {}, None)
        self.assertEqual(counter.read_text().count('x'), 1)


    def test_images_in_messages_can_be_fetched(self):
        shot = Path(self.tmp.name) / 'shot.png'
        shot.write_bytes(b'png-bytes')
        secret = Path(self.tmp.name) / 'notes.txt'
        secret.write_text('private')
        pasted = base64.b64encode(b'jpeg-bytes').decode()
        record_handoff(self.config, 's-old', 's-new')
        self.write_transcript('s-new', [
            entry('user', [{'type': 'text', 'text': 'look'},
                           {'type': 'image', 'source': {'type': 'base64', 'media_type': 'image/jpeg', 'data': pasted}}], 'u-01'),
            entry('assistant', [{'type': 'tool_use', 'name': 'SendUserFile',
                                 'input': {'files': [str(shot), str(secret)], 'caption': 'here'}}], 'a-02'),
            entry('user', f'from phone\n[image: {shot}]', 'u-03'),
        ])
        _, body = self.api.handle('GET', '/api/contacts/w1/messages', {}, None)
        got = [(m['role'], m['text'], len(m['images'])) for m in body['messages']]
        self.assertEqual(got, [('user', 'look', 1), ('assistant', 'here', 1), ('user', 'from phone', 1)])
        first = self.api.handle('GET', body['messages'][0]['images'][0], {}, None)[1]
        self.assertEqual((first.data, first.content_type), (b'jpeg-bytes', 'image/jpeg'))
        second = self.api.handle('GET', body['messages'][1]['images'][0], {}, None)[1]
        self.assertEqual((second.data, second.content_type), (b'png-bytes', 'image/png'))
        self.assertEqual(self.api.handle('GET', '/api/images/unknown', {}, None)[0], 404)

    def test_preview_of_image_only_message(self):
        record_handoff(self.config, 's-old', 's-new')
        self.write_transcript('s-new', [entry('user', '[image: /tmp/x.png]', 'u-01')])
        preview = next(c for c in self.api.list_contacts() if c['id'] == 'w1')['preview']
        self.assertEqual(preview['text'], '[圖片]')
        self.assertNotIn('images', preview)

    def test_send_with_images_saves_and_references_them(self):
        photo = {'type': 'image/jpeg', 'data': base64.b64encode(b'photo').decode()}
        status, _ = self.api.handle('POST', '/api/contacts/w2/messages', {}, {'text': 'see', 'images': [photo]})
        self.assertEqual(status, 202)
        pane, text = self.herdr.prompts[0]
        saved = Path(text.split('[image: ')[1].rstrip(']'))
        self.assertEqual((pane, text.splitlines()[0], saved.read_bytes()), ('w2:p1', 'see', b'photo'))
        self.assertEqual(saved.parent, self.config.state_dir / 'uploads' / 's-web')
        bad = {'type': 'image/jpeg', 'data': 'not base64!'}
        self.assertEqual(self.api.handle('POST', '/api/contacts/w2/messages', {}, {'images': [bad]})[0], 400)
        exe = {'type': 'application/x-sh', 'data': base64.b64encode(b'x').decode()}
        self.assertEqual(self.api.handle('POST', '/api/contacts/w2/messages', {}, {'images': [exe]})[0], 400)
        self.assertEqual(self.api.handle('POST', '/api/contacts/w2/messages', {}, {'images': [photo] * 7})[0], 400)
        self.assertEqual(len(self.herdr.prompts), 1)


    def test_send_files_keeps_name_and_shows_it(self):
        doc = {'name': '../報價 v2.pdf', 'data': base64.b64encode(b'%PDF').decode()}
        status, _ = self.api.handle('POST', '/api/contacts/w2/messages', {}, {'text': 'read this', 'files': [doc]})
        self.assertEqual(status, 202)
        text = self.herdr.prompts[0][1]
        saved = Path(text.split('[file: ')[1].rstrip(']'))
        self.assertEqual((saved.parent, saved.read_bytes()), (self.config.state_dir / 'uploads' / 's-web', b'%PDF'))
        self.assertTrue(saved.name.endswith('-報價_v2.pdf'))
        self.write_transcript('s-web', [entry('user', text, 'u-01')])
        _, body = self.api.handle('GET', '/api/contacts/w2/messages', {}, None)
        self.assertEqual((body['messages'][0]['text'], body['messages'][0]['files']), ('read this', ['報價_v2.pdf']))
        self.write_transcript('s-web', [entry('user', f'[file: {saved}]', 'u-02')])
        preview = next(c for c in self.api.list_contacts() if c['id'] == 'w2')['preview']
        self.assertEqual(preview['text'], '[檔案] 報價_v2.pdf')


    def test_account_label_follows_transcript_location(self):
        other = Path(self.tmp.name) / '.claude-b'
        (other / 'projects/p').mkdir(parents=True)
        (other / 'projects/p/s-web.jsonl').write_text(entry('user', 'hi', 'u-01') + '\n')
        self.config.config_dirs.append(other)
        self.config.account_labels = {'claude-b': 'Work'}
        self.write_transcript('s-old', [entry('user', 'hi', 'u-02')])
        accounts = {c['id']: c['account'] for c in self.api.list_contacts()}
        self.assertEqual(accounts, {'w1': 'claude', 'w2': 'Work'})
        self.assertEqual(self.api.handle('GET', '/api/contacts/w2/messages', {}, None)[1]['account'], 'Work')


    def test_exit_quits_claude_then_closes_space(self):
        import herdline_bridge.api as api_mod
        api_mod.EXIT_WAIT_STEPS = 1
        api_mod.EXIT_WAIT_SECONDS = 0
        # w2 has only the main session: the whole space closes.
        status, body = self.api.handle('POST', '/api/contacts/w2/exit', {}, {})
        self.assertEqual((status, body), (200, {'closed': 'space'}))
        self.assertEqual(self.herdr.prompts, [('w2:p1', '/exit')])
        self.assertEqual(self.herdr.closed, [('space', 'w2')])

    def test_exit_keeps_space_when_other_agents_run_there(self):
        import herdline_bridge.api as api_mod
        api_mod.EXIT_WAIT_STEPS = 1
        api_mod.EXIT_WAIT_SECONDS = 0
        record_handoff(self.config, 's-old', 's-new')
        self.herdr._agents[1]['agent_status'] = 'idle'
        # w1 also holds the old session and a codex pane: only the on-duty pane closes.
        status, body = self.api.handle('POST', '/api/contacts/w1/exit', {}, {})
        self.assertEqual((status, body), (200, {'closed': 'pane'}))
        self.assertEqual(self.herdr.closed, [('pane', 'w1:p2')])

    def test_exit_asks_before_stopping_a_busy_session(self):
        import herdline_bridge.api as api_mod
        api_mod.EXIT_WAIT_STEPS = 1
        api_mod.EXIT_WAIT_SECONDS = 0
        record_handoff(self.config, 's-old', 's-new')  # s-new is working
        self.assertEqual(self.api.handle('POST', '/api/contacts/w1/exit', {}, {})[1], {'error': 'busy'})
        self.assertEqual(self.herdr.closed, [])
        self.assertEqual(self.api.handle('POST', '/api/contacts/w1/exit', {}, {'force': True})[0], 200)


    def test_exit_removes_that_conversations_uploads(self):
        import herdline_bridge.api as api_mod
        api_mod.EXIT_WAIT_STEPS = 1
        api_mod.EXIT_WAIT_SECONDS = 0
        photo = {'type': 'image/png', 'data': base64.b64encode(b'png').decode()}
        self.api.handle('POST', '/api/contacts/w2/messages', {}, {'images': [photo]})
        record_handoff(self.config, 's-old', 's-new')
        self.herdr._agents[1]['agent_status'] = 'idle'
        self.api.handle('POST', '/api/contacts/w1/messages', {}, {'images': [photo]})
        saved = Path(self.herdr.prompts[0][1].split('[image: ')[1].rstrip(']'))
        self.write_transcript('s-web', [entry('user', f'[image: {saved}]', 'u-01')])
        _, body = self.api.handle('GET', '/api/contacts/w2/messages', {}, None)
        image_url = body['messages'][0]['images'][0]
        self.assertEqual(self.api.handle('GET', image_url, {}, None)[0], 200)
        self.api.handle('POST', '/api/contacts/w2/exit', {}, {})
        uploads = self.config.state_dir / 'uploads'
        self.assertFalse((uploads / 's-web').exists())
        self.assertTrue((uploads / 's-new').exists())  # another conversation keeps its files
        self.assertEqual(self.api.handle('GET', image_url, {}, None)[0], 404)


if __name__ == '__main__':
    unittest.main()
