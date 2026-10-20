import { TestBed } from '@angular/core/testing';
import { VoiceInputService } from './voice-input.service';

describe('Russian voice input',()=>{
  let original:PropertyDescriptor|undefined,webkit:PropertyDescriptor|undefined,native:PropertyDescriptor|undefined;
  let recognition:any;
  beforeEach(()=>{
    original=Object.getOwnPropertyDescriptor(window,'SpeechRecognition');
    webkit=Object.getOwnPropertyDescriptor(window,'webkitSpeechRecognition');
    native=Object.getOwnPropertyDescriptor(window,'aiRouterVoice');
    Object.defineProperty(window,'aiRouterVoice',{configurable:true,value:undefined});
    Object.defineProperty(window,'SpeechRecognition',{configurable:true,value:class {
      lang='';continuous=false;interimResults=false;
      onresult:any;onerror:any;onend:any;
      start=jasmine.createSpy('start');stop=jasmine.createSpy('stop');abort=jasmine.createSpy('abort');
      constructor(){recognition=this;}
    }});
    TestBed.configureTestingModule({providers:[VoiceInputService]});
  });
  afterEach(()=>{
    for(const [name,descriptor] of [['SpeechRecognition',original],['webkitSpeechRecognition',webkit],['aiRouterVoice',native]] as const){
      if(descriptor)Object.defineProperty(window,name,descriptor);else delete (window as any)[name];
    }
  });
  it('uses ru-RU, separates interim text, and commits final text once',async()=>{
    const voice=TestBed.inject(VoiceInputService),commit=jasmine.createSpy('commit');
    await voice.start(commit);
    expect(recognition.lang).toBe('ru-RU');expect(voice.busy).toBeTrue();
    const partial=Object.assign([{transcript:'Привет'}],{isFinal:false});
    recognition.onresult({resultIndex:0,results:[partial]});
    expect(voice.interim()).toBe('Привет');expect(commit).not.toHaveBeenCalled();
    recognition.onresult({resultIndex:0,results:[Object.assign([{transcript:'Привет мир'}],{isFinal:true})]});
    recognition.onend();
    expect(commit).toHaveBeenCalledOnceWith('Привет мир');expect(voice.busy).toBeFalse();
  });
  it('keeps the last partial on stop and removes callbacks when navigating away',async()=>{
    const voice=TestBed.inject(VoiceInputService),commit=jasmine.createSpy('commit');
    await voice.start(commit);
    recognition.onresult({resultIndex:0,results:[Object.assign([{transcript:'Сохрани черновик'}],{isFinal:false})]});
    await voice.stop();expect(recognition.stop).toHaveBeenCalled();
    recognition.onend();expect(commit).toHaveBeenCalledOnceWith('Сохрани черновик');
    await voice.start(commit);const last=recognition;
    voice.cancel();expect(last.abort).toHaveBeenCalled();expect(last.onresult).toBeNull();expect(voice.busy).toBeFalse();
  });
  it('explains microphone permissions and unsupported browsers',async()=>{
    const voice=TestBed.inject(VoiceInputService);await voice.start(()=>{});
    recognition.onerror({error:'not-allowed'});recognition.onend();
    expect(voice.error()).toContain('microphone');
    Object.defineProperty(window,'SpeechRecognition',{configurable:true,value:undefined});
    Object.defineProperty(window,'webkitSpeechRecognition',{configurable:true,value:undefined});
    await voice.start(()=>{});expect(voice.error()).toContain('unavailable in this browser');expect(voice.busy).toBeFalse();
  });
  it('uses the Mac bridge and does not duplicate its final transcript',async()=>{
    let listener:(event:any)=>void=()=>{};
    const unsubscribe=jasmine.createSpy('unsubscribe'),start=jasmine.createSpy('start').and.resolveTo(),stop=jasmine.createSpy('stop').and.resolveTo();
    Object.defineProperty(window,'aiRouterVoice',{configurable:true,value:{start,stop,onEvent:(callback:any)=>{listener=callback;return unsubscribe;}}});
    const voice=TestBed.inject(VoiceInputService),commit=jasmine.createSpy('commit');
    await voice.start(commit);listener({type:'ready'});
    listener({type:'result',text:'Проверь сборку',final:false});
    expect(voice.interim()).toBe('Проверь сборку');
    await voice.stop();expect(stop).toHaveBeenCalled();
    listener({type:'result',text:'Проверь сборку',final:true});listener({type:'end'});
    expect(commit).toHaveBeenCalledOnceWith('Проверь сборку');expect(unsubscribe).toHaveBeenCalled();expect(voice.busy).toBeFalse();
  });
});
