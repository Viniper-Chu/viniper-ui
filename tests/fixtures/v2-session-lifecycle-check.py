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
async def main():
    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=server.app),base_url='http://127.0.0.1:17959') as client:
        created=await client.post('/api/sessions',json={'mode':'viniper','workdir':str(root),'permission_mode':'ask'})
        assert created.status_code==200,created.text
        sid=created.json()['session_id'];assert (await client.delete('/api/sessions/'+sid)).status_code==200
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
