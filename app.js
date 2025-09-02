document.addEventListener('DOMContentLoaded', () => {
    // Elementos de la UI
    const trackInput = document.getElementById('trackInput');
    const recordButton = document.getElementById('recordButton');
    const stopButton = document.getElementById('stopButton');
    const recordingStatus = document.getElementById('recordingStatus');
    const playbackControls = document.getElementById('playbackControls');
    const audioPlayback = document.getElementById('audioPlayback');
    const downloadButton = document.getElementById('downloadButton');
    const processingStatus = document.getElementById('processingStatus');
    const reverbSwitch = document.getElementById('reverbSwitch');
    const echoSwitch = document.getElementById('echoSwitch');
    const popFilterSwitch = document.getElementById('popFilterSwitch');

    // Variables de Audio
    let mediaRecorder;
    let recordedChunks = [];
    let audioContext;
    let backingTrackSource;
    let backingTrackBuffer;
    let vocalTrackBuffer;

    trackInput.addEventListener('change', async (event) => {
        const file = event.target.files[0];
        if (file) {
            recordButton.disabled = false;
            if (!audioContext) {
                audioContext = new (window.AudioContext || window.webkitAudioContext)();
            }
            const arrayBuffer = await file.arrayBuffer();
            try {
                backingTrackBuffer = await audioContext.decodeAudioData(arrayBuffer);
            } catch (e) {
                alert('No se pudo decodificar el archivo de audio. Por favor, intente con otro formato (MP3, WAV).');
                return;
            }
        }
    });

    recordButton.addEventListener('click', async () => {
        try {
            const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
            mediaRecorder = new MediaRecorder(stream);

            mediaRecorder.ondataavailable = (event) => {
                if (event.data.size > 0) recordedChunks.push(event.data);
            };

            mediaRecorder.onstop = async () => {
                const blob = new Blob(recordedChunks, { type: 'audio/webm' });
                const url = URL.createObjectURL(blob);
                audioPlayback.src = url;
                playbackControls.style.display = 'block';

                const arrayBuffer = await blob.arrayBuffer();
                vocalTrackBuffer = await audioContext.decodeAudioData(arrayBuffer);
                recordedChunks = [];
                 // Detener el stream del micrófono para que el indicador del navegador desaparezca
                stream.getTracks().forEach(track => track.stop());
            };

            backingTrackSource = audioContext.createBufferSource();
            backingTrackSource.buffer = backingTrackBuffer;
            backingTrackSource.connect(audioContext.destination);
            backingTrackSource.start();

            recordedChunks = [];
            mediaRecorder.start();

            recordButton.disabled = true;
            recordButton.classList.add('recording');
            stopButton.disabled = false;
            recordingStatus.style.display = 'block';
            playbackControls.style.display = 'none';

        } catch (err) {
            alert('No se pudo acceder al micrófono. Por favor, otorga los permisos necesarios.');
            console.error(err);
        }
    });

    stopButton.addEventListener('click', () => {
        if (mediaRecorder && mediaRecorder.state !== 'inactive') {
            mediaRecorder.stop();
        }
        if (backingTrackSource) {
            backingTrackSource.stop();
        }

        recordButton.disabled = false;
        recordButton.classList.remove('recording');
        stopButton.disabled = true;
        recordingStatus.style.display = 'none';
    });

    downloadButton.addEventListener('click', async () => {
        if (!backingTrackBuffer || !vocalTrackBuffer) {
            alert('Por favor, graba tu voz sobre una pista primero.');
            return;
        }

        processingStatus.style.display = 'block';
        downloadButton.disabled = true;

        try {
            const duration = Math.max(backingTrackBuffer.duration, vocalTrackBuffer.duration);
            const offlineContext = new OfflineAudioContext(2, audioContext.sampleRate * duration, audioContext.sampleRate);

            // Fuente de la pista de fondo
            const backingSource = offlineContext.createBufferSource();
            backingSource.buffer = backingTrackBuffer;
            backingSource.connect(offlineContext.destination);

            // Fuente de la voz y cadena de efectos
            const vocalSource = offlineContext.createBufferSource();
            vocalSource.buffer = vocalTrackBuffer;

            let lastNode = vocalSource;

            if (popFilterSwitch.checked) {
                const highpass = offlineContext.createBiquadFilter();
                highpass.type = 'highpass';
                highpass.frequency.value = 80;
                const peak = offlineContext.createBiquadFilter();
                peak.type = 'peaking';
                peak.frequency.value = 3500;
                peak.gain.value = 3;
                lastNode.connect(highpass).connect(peak);
                lastNode = peak;
            }

            if (reverbSwitch.checked) {
                const convolver = offlineContext.createConvolver();
                convolver.buffer = await createImpulseResponse(offlineContext);
                lastNode.connect(convolver);
                lastNode = convolver;
            }
            
            // El delay se maneja de forma diferente porque tiene un feedback loop
            if (echoSwitch.checked) {
                const delay = offlineContext.createDelay(1.0);
                delay.delayTime.value = 0.4;
                const feedback = offlineContext.createGain();
                feedback.gain.value = 0.4;
                const wetLevel = offlineContext.createGain();
                wetLevel.gain.value = 0.5;

                lastNode.connect(delay);
                delay.connect(feedback).connect(delay);
                delay.connect(wetLevel).connect(offlineContext.destination);
                lastNode.connect(offlineContext.destination); // Dry signal
            } else {
                lastNode.connect(offlineContext.destination);
            }

            backingSource.start(0);
            vocalSource.start(0);

            const renderedBuffer = await offlineContext.startRendering();
            const wavBlob = bufferToWave(renderedBuffer);
            const url = URL.createObjectURL(wavBlob);

            const a = document.createElement('a');
            a.style.display = 'none';
            a.href = url;
            a.download = 'cancion-terminada.wav';
            document.body.appendChild(a);
            a.click();
            window.URL.revokeObjectURL(url);
            document.body.removeChild(a);

        } catch (e) {
            alert('Ocurrió un error al procesar el audio.');
            console.error(e);
        } finally {
            processingStatus.style.display = 'none';
            downloadButton.disabled = false;
        }
    });

    async function createImpulseResponse(context) {
        const duration = 2;
        const sampleRate = context.sampleRate;
        const length = sampleRate * duration;
        const impulse = context.createBuffer(2, length, sampleRate);

        for (let channel = 0; channel < 2; channel++) {
            const channelData = impulse.getChannelData(channel);
            for (let i = 0; i < length; i++) {
                channelData[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / length, 2.5);
            }
        }
        return impulse;
    }

    function bufferToWave(buffer) {
        const numOfChan = buffer.numberOfChannels;
        const length = buffer.length * numOfChan * 2 + 44;
        const bufferOut = new ArrayBuffer(length);
        const view = new DataView(bufferOut);
        const channels = [];
        let offset = 0;

        const setUint16 = (data) => {
            view.setUint16(offset, data, true);
            offset += 2;
        };
        const setUint32 = (data) => {
            view.setUint32(offset, data, true);
            offset += 4;
        };

        setUint32(0x46464952); // "RIFF"
        setUint32(length - 8);
        setUint32(0x45564157); // "WAVE"
        setUint32(0x20746d66); // "fmt "
        setUint32(16);
        setUint16(1);
        setUint16(numOfChan);
        setUint32(buffer.sampleRate);
        setUint32(buffer.sampleRate * 2 * numOfChan);
        setUint16(numOfChan * 2);
        setUint16(16);
        setUint32(0x61746164); // "data"
        setUint32(length - offset - 4);

        for (let i = 0; i < buffer.numberOfChannels; i++) {
            channels.push(buffer.getChannelData(i));
        }

        let pos = 0;
        while (pos < buffer.length) {
            for (let i = 0; i < numOfChan; i++) {
                let sample = Math.max(-1, Math.min(1, channels[i][pos]));
                sample = (0.5 + sample < 0 ? sample * 32768 : sample * 32767) | 0;
                view.setInt16(offset, sample, true);
                offset += 2;
            }
            pos++;
        }

        return new Blob([view], { type: 'audio/wav' });
    }
});

