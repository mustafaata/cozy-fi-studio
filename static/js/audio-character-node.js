const AUDIO_CHARACTER_WORKLET=Object.freeze({module:'/static/js/audio-character-worklet.js',processor:'studio-character',label:'Ses karakteri',contexts:new WeakMap()});
function audioPresetIsCharacter(preset){return ['bitcrush','vinyl','cassette','telephone','rateDust','tremolo','wah','stepGate','staircase','stutter'].includes(preset?.algorithm);}
async function prepareAudioCharacterContext(context){await prepareAudioPresetWorkletContext(context,AUDIO_CHARACTER_WORKLET);}
