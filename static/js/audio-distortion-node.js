const AUDIO_DISTORTION_WORKLET=Object.freeze({module:'/static/js/audio-distortion-worklet.js',processor:'studio-distortion',label:'Distorsiyon',contexts:new WeakMap()});
function audioPresetIsDistortion(preset){return ['tape','tube','grit','fuzz','wavefold'].includes(preset?.algorithm);}
async function prepareAudioDistortionContext(context){await prepareAudioPresetWorkletContext(context,AUDIO_DISTORTION_WORKLET);}
