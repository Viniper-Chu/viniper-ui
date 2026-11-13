"""A deleted session must not be recreated by a still-open page's polling."""
import asyncio,json,os,sys
from pathlib import Path
root=Path(sys.argv[1]).resolve()
assert root.is_relative_to(Path.cwd()/'codex/运行残留')
for key in list(os.environ):
    if key.startswith(('VINIPER_','ANTHROPIC_','CLAUDE_','OPENAI_')):os.environ.pop(key)
os.environ.update(VINIPER_UI_DATA_DIR=str(root/'data'),CLAUDE_CONFIG_DIR=str(root/'claude'),VINIPER_UI_DEFAULT_WORKSPACE_ROOT=str(root),VINIPER_UI_PORT='17959',VINIPER_HARNESS_ALLOW_EXTERNAL_NETWORK='0')
sys.path.insert(0,str(Path.cwd()/'resources/viniper-ui'))
import httpx,server
class Port:
    async def delete_session(self,sid):return {'deleted':True}
    async def control(self,op,**kwargs):
        if op=='scheduler.create':return {'schedule':{'id':'fixture-cron','native_session_id':kwargs['native_session_id']}}
        return {'ok':True}
server.VINIPER_TRANSPORT.application_port=Port()
server.provider_config=lambda *_args,**_kwargs:{'model':'fixture','provider':'fixture','base_url':'http://127.0.0.1:1','api_key':''}
requests=[]
async def fixture_stream(sid,prompt,**kwargs):
    requests.append((sid,kwargs))
    yield server.sse({'type':'text','content':'fixture accepted'})
    yield server.sse({'type':'done'})
server.stream_viniper_with_queue=fixture_stream
server.get_skills=lambda *_args,**_kwargs:[]
server.allowed_model=lambda *_args,**_kwargs:'fixture'
async def main():
    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=server.app),base_url='http://127.0.0.1:17959') as client:
        created=await client.post('/api/sessions',json={'mode':'viniper','workdir':str(root),'permission_mode':'ask'})
        assert created.status_code==200,created.text
        sid=created.json()['session_id']
        other=await client.post('/api/sessions',json={'mode':'viniper','name':'keep me','workdir':str(root)})
        other_id=other.json()['session_id']
        changed=await client.put('/api/sessions/'+sid,json={'name':'renamed','pinned':True})
        assert changed.status_code==200,changed.text
        listed=(await client.get('/api/sessions')).json()['sessions']
        assert listed[0]['id']==sid and listed[0]['name']=='renamed' and listed[0]['pinned']
        saved=server.load_sessions_from_disk()
        assert saved[sid]['name']=='renamed' and saved[sid]['pinned']
        assert saved[other_id]['name']=='keep me' and not saved[other_id]['pinned']
        assert (await client.put('/api/sessions/'+sid,json={'pinned':False})).status_code==200
        assert not server.load_sessions_from_disk()[sid]['pinned']
        gate=asyncio.Event()
        async def waiting():
            await gate.wait()
            yield server.sse({'type':'done'})
        run=server.agent_run_coordinator().start(sid,waiting)
        blocked=await client.delete('/api/sessions/'+sid)
        assert blocked.status_code==409 and sid in server.sessions,blocked.text
        gate.set();await run.task
        assert (await client.delete('/api/sessions/'+other_id)).status_code==200
        # The permission selector no longer exists. Omitted client fields must
        # use the stored policy, including conversations created before 2.2.2.
        for permission in ('ask','review','fullAccess'):
            server.sessions[sid]['permission_mode']=permission
            for task_mode in ('execute','plan'):
                reply=await client.post('/api/runs/'+sid,json={'mode':'viniper','message':'fixture','task_mode':task_mode,'reasoning':'off'})
                assert reply.status_code==200 and 'fixture accepted' in reply.text,reply.text
                assert requests[-1][1]['permission_mode']==permission,(permission,requests[-1],server.sessions[sid]['permission_mode'])
                assert server.sessions[sid]['permission_mode']==permission
                assert server.sessions[sid]['task_mode']==task_mode
            goal=await client.post('/api/goals',json={'session_id':sid,'prompt':'future goal','reasoning':'off'})
            assert goal.status_code==200,goal.text
            assert goal.json()['goal']['permission_mode']==permission,goal.text
            assert (await client.delete('/api/goals/'+goal.json()['goal']['id'])).status_code==200
            stale=await client.post('/api/runs/'+sid,json={'mode':'viniper','message':'stale client','permission_mode':'fullAccess' if permission=='ask' else 'ask'})
            assert stale.status_code==409,stale.text
        assert (await client.delete('/api/sessions/'+sid)).status_code==200
        for path in (f'/api/sessions/{sid}',f'/api/runs/{sid}/queue',f'/api/skills?mode=viniper&session_id={sid}'):
            r=await client.get(path);assert r.status_code==404,(path,r.text)
        assert sid not in server.sessions
        assert not (await client.get('/api/sessions')).json()['sessions']
        scheduled=await client.post('/api/schedules',json={'title':'fixture','prompt':'future work','cron':'0 9 * * *','workdir':str(root),'permission_mode':'ask'})
        assert scheduled.status_code==200,scheduled.text
        schedule_sid=scheduled.json()['schedule']['native_session_id']
        assert schedule_sid in server.sessions and len(server.sessions)==1
    print('V2_SESSION_LIFECYCLE_PASS')
asyncio.run(main())
