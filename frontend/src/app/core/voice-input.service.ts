import { Injectable, NgZone, inject, signal } from '@angular/core';

interface VoiceEvent { type:'ready'|'result'|'error'|'end';text?:string;message?:string;final?:boolean; }
interface NativeVoice { start():Promise<void>;stop():Promise<void>;onEvent(callback:(event:VoiceEvent)=>void):()=>void; }
interface Recognition {
  lang:string;continuous:boolean;interimResults:boolean;
  onresult:((event:any)=>void)|null;onerror:((event:{error:string})=>void)|null;onend:(()=>void)|null;
  start():void;stop():void;abort():void;
}
export function speechError(code:string) {
  return ({'not-allowed':'Allow microphone and speech recognition access in your device settings.','service-not-allowed':'Speech recognition is unavailable. Check your device permissions.','audio-capture':'No microphone found, or another app is using it.','network':'Unable to connect to speech recognition. Check your internet connection.','no-speech':'No speech detected. Click the microphone and try again.','language-not-supported':'Russian speech recognition is unavailable on this device.'} as Record<string,string>)[code]||'Unable to recognize speech. Try again.';
}

@Injectable()
export class VoiceInputService {
  private zone=inject(NgZone);
  active=signal(false);starting=signal(false);stopping=signal(false);interim=signal('');error=signal('');
  private recognition?:Recognition;private unsubscribe?:()=>void;private commit?:(text:string)=>void;
  private partial='';private native=(window as unknown as {aiRouterVoice?:NativeVoice}).aiRouterVoice;
  private get Constructor() { return (window as unknown as {SpeechRecognition?:new()=>Recognition;webkitSpeechRecognition?:new()=>Recognition}).SpeechRecognition||(window as unknown as {webkitSpeechRecognition?:new()=>Recognition}).webkitSpeechRecognition; }
  get supported() { return !!this.native||!!this.Constructor; }
  get busy() {return this.active()||this.starting()||this.stopping();}
  async start(commit:(text:string)=>void) {
    if(this.busy)return;this.error.set('');this.interim.set('');this.partial='';this.commit=commit;
    if(!this.supported){this.error.set('Voice input is unavailable in this browser. Open AI Router in Chrome or Safari, or update the Mac app.');return;}
    this.starting.set(true);
    if(this.native) {
      this.unsubscribe=this.native.onEvent(event=>this.zone.run(()=>{
        if(event.type==='ready'){this.starting.set(false);this.active.set(true);}
        if(event.type==='result'){
          this.partial=event.text||'';this.interim.set(this.partial);
          if(event.final){this.append(this.partial);this.partial='';this.interim.set('');}
        }
        if(event.type==='error'){this.error.set(event.message||speechError('unknown'));}
        if(event.type==='end'){this.append(this.partial);this.reset();}
      }));
      try {await this.native.start();}catch{this.error.set('Unable to start dictation. Update the app and check microphone and speech recognition permissions.');this.reset();}
      return;
    }
    const recognition=new this.Constructor!();this.recognition=recognition;
    recognition.lang='ru-RU';recognition.continuous=true;recognition.interimResults=true;
    recognition.onresult=event=>this.zone.run(()=>{
      this.starting.set(false);this.active.set(true);let interim='';
      for(let i=event.resultIndex;i<event.results.length;i++) {
        const result=event.results[i],text=result[0]?.transcript||'';
        if(result.isFinal)this.append(text);else interim+=text;
      }
      this.partial=interim;this.interim.set(interim);
    });
    recognition.onerror=event=>this.zone.run(()=>{if(event.error!=='aborted')this.error.set(speechError(event.error));});
    recognition.onend=()=>this.zone.run(()=>{this.append(this.partial);this.reset();});
    try {recognition.start();this.starting.set(false);this.active.set(true);}catch{this.error.set(speechError('not-allowed'));this.reset();}
  }
  private append(text:string) {if(text.trim())this.commit?.(text.trim());}
  async stop() {
    if(!this.busy||this.stopping())return;this.stopping.set(true);
    try {if(this.native)await this.native.stop();else this.recognition?.stop();}
    catch{this.append(this.partial);this.reset();}
  }
  cancel() {
    this.commit=undefined;this.partial='';
    if(this.native){this.unsubscribe?.();this.unsubscribe=undefined;void this.native.stop().catch(()=>{});}
    if(this.recognition){this.recognition.onresult=null;this.recognition.onend=null;this.recognition.onerror=null;this.recognition.abort();}
    this.reset();
  }
  private reset() {this.unsubscribe?.();this.unsubscribe=undefined;this.recognition=undefined;this.partial='';this.interim.set('');this.active.set(false);this.starting.set(false);this.stopping.set(false);this.commit=undefined;}
}
