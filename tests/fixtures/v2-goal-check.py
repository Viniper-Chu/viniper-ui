import asyncio
import copy
import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parents[2]/'resources/viniper-ui'))
from goal_service import GoalService,DONE,CONTINUE
from agent_run_coordinator import AgentRunCoordinator
from schedule_host import ScheduleHost

class Port:
    def __init__(self): self.saved=None;self.due=[];self.calls=[]
    async def control(self,op,**kwargs):
        self.calls.append((op,kwargs))
        if op=='goals.load':return {'goals':copy.deepcopy(self.saved)}
        if op=='goals.save':self.saved=copy.deepcopy(kwargs['goals']);return {'ok':True}
        if op=='scheduler.claim':return {'due':self.due}
        return {'ok':True}

async def settled(service,gid):
    await asyncio.wait_for(service.tasks[gid],2)

async def main():
    port=Port();coordinator=AgentRunCoordinator();requests=[];session={'mode':'viniper'}
    async def stream(sid,prompt,**kwargs):
        requests.append((sid,prompt,kwargs))
        yield {'type':'tool_result','content':'已回读成果'}
        yield {'type':'text','content':'已完成\n'+DONE}
        yield {'type':'done'}
    def factory():return GoalService(port=port,coordinator=coordinator,stream=stream,session=lambda sid:session,save_sessions=lambda:None)
    service=factory();goal=await service.create({'session_id':'s1','prompt':'创建成果并核验','reasoning':'low','skills':['fixture-skill']})
    session.update(task_mode='plan',reasoning='high',selected_skills=['unrelated-skill'])
    await service.control(goal['id'],'continue');await settled(service,goal['id'])
    assert service.items[goal['id']]['status']=='complete'
    assert requests[0][2]['display_prompt']=='创建成果并核验'
    assert session['task_mode']=='goal' and session['reasoning']=='low' and session['selected_skills']==['fixture-skill']
    assert port.saved[goal['id']]['reasoning']=='low' and port.saved[goal['id']]['skills']==['fixture-skill']
    reopened=factory();assert (await reopened.list())[0]['status']=='complete'
    await service.control(goal['id'],'delete');assert not port.saved
    # Automatic continuation belongs to the same user goal. Its original
    # tool restrictions must remain effective even though no new user bubble
    # is displayed for that continuation.
    continuation_requests=[]
    async def continue_goal(sid,prompt,**kwargs):
        continuation_requests.append(kwargs)
        yield {'type':'tool_result','content':'读取下一份资料'}
        yield {'type':'text','content':CONTINUE if len(continuation_requests)==1 else DONE}
        yield {'type':'done'}
    service.stream=continue_goal
    goal=await service.create({'session_id':'s1','prompt':'只用 file.read 完成资料核对'})
    await service.control(goal['id'],'continue');await settled(service,goal['id'])
    assert service.items[goal['id']]['status']=='complete'
    assert [r['display_prompt'] for r in continuation_requests]==[goal['prompt'],goal['prompt']]
    assert [r['suppress_user_message'] for r in continuation_requests]==[False,True]
    await service.control(goal['id'],'delete')
    # No-tool replies cannot auto-loop forever.
    async def no_progress(*args,**kwargs):
        yield {'type':'text','content':'还需要继续\n'+CONTINUE}
        yield {'type':'done'}
    service.stream=no_progress
    goal=await service.create({'session_id':'s1','prompt':'推进任务'})
    await service.control(goal['id'],'continue');await settled(service,goal['id'])
    assert service.items[goal['id']]['status']=='blocked'
    assert service.items[goal['id']]['turn_count']==1
    await service.control(goal['id'],'delete')
    # Pause changes the controller without killing a tool already running.
    gate=asyncio.Event();started=asyncio.Event()
    async def slow(*args,**kwargs):
        started.set();await gate.wait()
        yield {'type':'tool_result','content':'工具已安全结束'}
        yield {'type':'text','content':'完成\n'+DONE};yield {'type':'done'}
    service.stream=slow;goal=await service.create({'session_id':'s1','prompt':'慢任务'})
    await service.control(goal['id'],'continue');await started.wait()
    await service.control(goal['id'],'stop');assert coordinator.has_active('s1')
    gate.set()
    for _ in range(100):
        if not coordinator.has_active('s1'):break
        await asyncio.sleep(.001)
    assert service.items[goal['id']]['status']=='paused'
    # Scheduled work waits while the exact conversation is active, then uses
    # the same model/permissions/run coordinator, without another agent.
    gate.clear();started.clear();record=coordinator.start('s1',lambda:slow())
    await started.wait();port.due=[{'id':'cron1','native_session_id':'s1','prompt':'定时任务'}]
    sessions={'s1':{'mode':'viniper','model':'qwen-local','permission_mode':'ask'}}
    host=ScheduleHost(port,coordinator,stream,sessions);await host.tick()
    assert port.calls[-1][0]=='scheduler.defer'
    gate.set();await record.task
    await host.tick();assert coordinator.has_active('s1')
    await coordinator._records['s1'].task
    assert requests[-1][2]['model']=='qwen-local' and requests[-1][2]['permission_mode']=='ask'
    assert any(op=='scheduler.record' and data['accepted'] for op,data in port.calls)
    await service.shutdown();await coordinator.shutdown()
    print('V2_GOALS_SCHEDULER_PASS')
asyncio.run(main())
