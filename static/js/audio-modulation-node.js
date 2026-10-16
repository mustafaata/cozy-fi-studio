const AUDIO_MODULATION_WORKLET=Object.freeze({module:'/static/js/audio-modulation-worklet.js',processor:'studio-modulation',label:'Modülasyon',contexts:new WeakMap()});
function audioPresetIsModulation(preset){return ['chorus','flanger','phaser','vibrato','rotary'].includes(preset?.algorithm);}
async function prepareAudioModulationContext(context){await prepareAudioPresetWorkletContext(context,AUDIO_MODULATION_WORKLET);}
