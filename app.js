document.addEventListener('DOMContentLoaded', () => {
    // --- REFERENCIAS A ELEMENTOS DE LA UI ---
    const trackInput = document.getElementById('trackInput');
    const trackVolume = document.getElementById('trackVolume');
    const pitchControl = document.getElementById('pitchControl');
    const pitchValue = document.getElementById('pitchValue');
    const lyricsInput = document.getElementById('lyricsInput');
    const recordButton = document.getElementById('recordButton');
    const stopButton = document.getElementById('stopButton');
    const lyricsDisplay = document.getElementById('lyricsDisplay');
    const recordingStatus = document.getElementById('recordingStatus');
    const playbackControls = document.getElementById('playbackControls');
    const audioPlayback = document.getElementById('audioPlayback');
    const previewVocalOnly = document.getElementById('previewVocalOnly');
    const previewWithTrack = document.getElementById('previewWithTrack');
    const reverbControl = document.getElementById('reverbControl');
    const echoControl = document.getElementById('echoControl');
    const popFilterSwitch = document.getElementById('popFilterSwitch');
    const downloadButton = document.getElementById('downloadButton');
    const processingStatus = document.getElementById('processingStatus');

    // --- VARIABLES DE ESTADO DE AUDIO ---
    let audioContext;
    let mediaRecorder;
    let recordedChunks = [];
    let backingTrackBuffer, vocalTrackBuffer, previewMixBuffer;
    let backingTrackSource, backingTrackGainNode;
    let vocalBlobUrl = null;
    let previewBlobUrl = null;

    // --- INICIALIZACIÓN Y MANEJO DE ENTRADAS ---

    // Cargar pista de fondo
    trackInput.addEventListener('change', async (event) => {
        const file = event.target.files[0];
        if (!file) return;
        recordButton.disabled = false;
        if (!audioContext) audioContext = new (window.AudioContext || window.webkitAudioContext)();
        try {
            backingTrackBuffer = await audioContext.decodeAudioData(await file.arrayBuffer());
        } catch (e) {
            alert('No se pudo decodificar el archivo de audio. Intente con otro formato (MP3, WAV).');
        }
    });

    // Control de volumen de monitoreo en tiempo real
    trackVolume.addEventListener('input', () => {
        if (backingTrackGainNode) backingTrackGainNode.gain.value = trackVolume.value;
    });

    // Control de tono en tiempo real
    pitchControl.addEventListener('input', () => {
        pitchValue.textContent = pitchControl.value;
        if (backingTrackSource) backingTrackSource.detune.value = pitchControl.value * 100;
    });

    // --- LÓGICA DE GRABACIÓN ---

    recordButton.addEventListener('click', async () => {
        try {
            // Pedir micrófono sin procesamiento automático del navegador
            const stream = await navigator.mediaDevices.getUserMedia({
                audio: {
                    echoCancellation: false,
                    noiseSuppression: false,
                    autoGainControl: false
                }
            });
            
            mediaRecorder = new MediaRecorder(stream);
            mediaRecorder.ondataavailable = e => { if (e.data.size > 0) recordedChunks.push(e.data); };
            mediaRecorder.onstop = handleRecordingStop;

            setupAndPlayBackingTrack();
            
            lyricsDisplay.textContent = lyricsInput.value;
            lyricsDisplay.style.display = 'block';
            
            recordedChunks = [];
            mediaRecorder.start();
            updateUIRecording(true);

        } catch (err) {
            alert('No se pudo acceder al micrófono. Por favor, otorga los permisos necesarios.');
            console.error(err);
        }
    });

    stopButton.addEventListener('click', () => {
        if (mediaRecorder?.state !== 'inactive') mediaRecorder.stop();
        if (backingTrackSource) backingTrackSource.stop();
        updateUIRecording(false);
    });

    function setupAndPlayBackingTrack() {
        backingTrackSource = audioContext.createBufferSource();
        backingTrackSource.buffer = backingTrackBuffer;
        backingTrackSource.detune.value = pitchControl.value * 100;

        backingTrackGainNode = audioContext.createGain();
        backingTrackGainNode.gain.value = trackVolume.value;

        backingTrackSource.connect(backingTrackGainNode).connect(audioContext.destination);
        backingTrackSource.start();
    }

    async function handleRecordingStop() {
        // Detener streams y limpiar
        this.stream.getTracks().forEach(track => track.stop());
        const vocalBlob = new Blob(recordedChunks, { type: 'audio/webm' });
        vocalBlobUrl = URL.createObjectURL(vocalBlob);
        recordedChunks = [];

        // Decodificar audio para manipulación
        vocalTrackBuffer = await audioContext.decodeAudioData(await vocalBlob.arrayBuffer());
        
        // Preparar previsualización
        previewVocalOnly.checked = true;
        audioPlayback.src = vocalBlobUrl;
        playbackControls.style.display = 'block';
        previewMixBuffer = null; // Invalidar mix anterior
        if(previewBlobUrl) URL.revokeObjectURL(previewBlobUrl);
    }

    // --- LÓGICA DE PREVISUALIZACIÓN ---

    previewVocalOnly.addEventListener('change', () => audioPlayback.src = vocalBlobUrl);
    previewWithTrack.addEventListener('change', async () => {
        if (!previewMixBuffer) {
            processingStatus.style.display = 'block';
            const mixBlob = await createPreviewMix();
            previewBlobUrl = URL.createObjectURL(mixBlob);
            previewMixBuffer = await audioContext.decodeAudioData(await mixBlob.arrayBuffer());
            processingStatus.style.display = 'none';
        }
        audioPlayback.src = previewBlobUrl;
    });

    async function createPreviewMix() {
        const duration = Math.max(backingTrackBuffer.duration, vocalTrackBuffer.duration);
        const offlineCtx = new OfflineAudioContext(2, audioContext.sampleRate * duration, audioContext.sampleRate);

        // Pista con su volumen y tono de monitoreo
        const trackSource = offlineCtx.createBufferSource();
        trackSource.buffer = backingTrackBuffer;
        trackSource.detune.value = pitchControl.value * 100;
        const trackGain = offlineCtx.createGain();
        trackGain.gain.value = trackVolume.value;
        trackSource.connect(trackGain).connect(offlineCtx.destination);

        // Voz
        const vocalSource = offlineCtx.createBufferSource();
        vocalSource.buffer = vocalTrackBuffer;
        vocalSource.connect(offlineCtx.destination);

        trackSource.start(0);
        vocalSource.start(0);

        const renderedBuffer = await offlineCtx.startRendering();
        return bufferToWave(renderedBuffer);
    }

    // --- LÓGICA DE DESCARGA Y EFECTOS ---

    downloadButton.addEventListener('click', async () => {
        if (!backingTrackBuffer || !vocalTrackBuffer) return;
        
        processingStatus.style.display = 'block';
        downloadButton.disabled = true;

        try {
            const duration = Math.max(backingTrackBuffer.duration, vocalTrackBuffer.duration);
            const offlineCtx = new OfflineAudioContext(2, audioContext.sampleRate * duration, audioContext.sampleRate);

            // Pista de fondo (volumen completo, pero con pitch)
            const finalTrackSource = offlineCtx.createBufferSource();
            finalTrackSource.buffer = backingTrackBuffer;
            finalTrackSource.detune.value = pitchControl.value * 100;
            finalTrackSource.connect(offlineCtx.destination);

            // Cadena de efectos para la voz
            const vocalSource = offlineCtx.createBufferSource();
            vocalSource.buffer = vocalTrackBuffer;
            let lastNode = vocalSource;

            // Filtro EQ
            if (popFilterSwitch.checked) {
                const highpass = offlineCtx.createBiquadFilter();
                highpass.type = 'highpass';
                highpass.frequency.value = 80;
                const peak = offlineCtx.createBiquadFilter();
                peak.type = 'peaking';
                peak.frequency.value = 3500;
                peak.gain.value = 3;
                lastNode.connect(highpass).connect(peak);
                lastNode = peak;
            }

            // Conectar a un nodo final para efectos paralelos
            const finalVocalNode = offlineCtx.createGain();
            lastNode.connect(finalVocalNode);

            // Reverb (paralelo)
            if (parseFloat(reverbControl.value) > 0) {
                const convolver = offlineCtx.createConvolver();
                convolver.buffer = await createImpulseResponse(offlineCtx);
                const reverbWet = offlineCtx.createGain();
                reverbWet.gain.value = parseFloat(reverbControl.value) * 1.5; // Amplificar un poco
                lastNode.connect(convolver).connect(reverbWet).connect(finalVocalNode);
            }

            // Echo (paralelo)
            if (parseFloat(echoControl.value) > 0) {
                const delay = offlineCtx.createDelay(1.0);
                delay.delayTime.value = 0.4;
                const feedback = offlineCtx.createGain();
                feedback.gain.value = 0.4;
                const echoWet = offlineCtx.createGain();
                echoWet.gain.value = parseFloat(echoControl.value);
                delay.connect(feedback).connect(delay);
                lastNode.connect(delay).connect(echoWet).connect(finalVocalNode);
            }

            finalVocalNode.connect(offlineCtx.destination);

            // Iniciar y renderizar
            finalTrackSource.start(0);
            vocalSource.start(0);
            const renderedBuffer = await offlineCtx.startRendering();
            
            // Descargar
            const wavBlob = bufferToWave(renderedBuffer);
            const url = URL.createObjectURL(wavBlob);
            const a = document.createElement('a');
            a.href = url;
            a.download = 'cancion-terminada.wav';
            document.body.appendChild(a);
            a.click();
            URL.revokeObjectURL(url);
            document.body.removeChild(a);

        } catch (e) {
            alert('Ocurrió un error al procesar el audio.');
            console.error(e);
        } finally {
            processingStatus.style.display = 'none';
            downloadButton.disabled = false;
        }
    });

    // --- HELPERS Y UTILIDADES ---

    function updateUIRecording(isRecording) {
        recordButton.disabled = isRecording;
        stopButton.disabled = !isRecording;
        recordingStatus.style.display = isRecording ? 'block' : 'none';
        lyricsDisplay.style.display = isRecording ? 'block' : 'none';
        if (!isRecording) recordButton.classList.remove('recording');
        else recordButton.classList.add('recording');
    }

    async function createImpulseResponse(context) {
        const duration = 2, sampleRate = context.sampleRate, length = sampleRate * duration;
        const impulse = context.createBuffer(2, length, sampleRate);
        for (let c = 0; c < 2; c++) {
            const data = impulse.getChannelData(c);
            for (let i = 0; i < length; i++) data[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / length, 2.5);
        }
        return impulse;
    }

    function bufferToWave(buffer) {
        const numOfChan = buffer.numberOfChannels, len = buffer.length * numOfChan * 2 + 44;
        const ab = new ArrayBuffer(len), view = new DataView(ab);
        const channels = [];
        let offset = 0, pos = 0;
        const setUint16 = d => { view.setUint16(offset, d, true); offset += 2; };
        const setUint32 = d => { view.setUint32(offset, d, true); offset += 4; };

        setUint32(0x46464952); // RIFF
        setUint32(len - 8);
        setUint32(0x45564157); // WAVE
        setUint32(0x20746d66); // fmt
        setUint32(16); setUint16(1); setUint16(numOfChan); setUint32(buffer.sampleRate);
        setUint32(buffer.sampleRate * 2 * numOfChan); setUint16(numOfChan * 2); setUint16(16);
        setUint32(0x61746164); // data
        setUint32(len - offset - 4);

        for (let i = 0; i < buffer.numberOfChannels; i++) channels.push(buffer.getChannelData(i));
        while (pos < buffer.length) {
            for (let i = 0; i < numOfChan; i++) {
                let sample = Math.max(-1, Math.min(1, channels[i][pos]));
                sample = (0.5 + sample < 0 ? sample * 32768 : sample * 32767) | 0;
                view.setInt16(offset, sample, true); offset += 2;
            }
            pos++;
        }
        return new Blob([view], { type: 'audio/wav' });
    }
});
