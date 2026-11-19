package app.wordyarn.reader;

import android.app.Activity;
import android.media.AudioAttributes;
import android.media.MediaPlayer;
import android.util.Log;
import com.k2fsa.sherpa.onnx.GeneratedAudio;
import com.k2fsa.sherpa.onnx.OfflineTts;
import com.k2fsa.sherpa.onnx.OfflineTtsConfig;
import com.k2fsa.sherpa.onnx.OfflineTtsKittenModelConfig;
import java.io.File;
import java.io.IOException;
import java.io.InputStream;
import java.nio.file.Files;
import java.nio.file.StandardCopyOption;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

final class OfflineVoice {
    interface Events { void send(String id, String event); }
    private final Activity host;
    private final Events events;
    private final ExecutorService worker = Executors.newSingleThreadExecutor();
    private volatile long revision;
    private OfflineTts engine; // worker only
    private MediaPlayer player; // main thread only
    private File clip;
    private boolean ready, paused, started, closed;
    private static final String PACK = "kitten-micro-en-v08";

    OfflineVoice(Activity host, Events events) {
        this.host = host;
        this.events = events;
    }

    private void copyAssets(String path, File dest) throws IOException {
        String[] children = host.getAssets().list(path);
        if (children != null && children.length > 0) {
            if (!dest.isDirectory() && !dest.mkdirs()) throw new IOException("Cannot create voice directory");
            for (String name : children) copyAssets(path + "/" + name, new File(dest, name));
        } else try (InputStream input = host.getAssets().open(path)) {
            Files.copy(input, dest.toPath(), StandardCopyOption.REPLACE_EXISTING);
        }
    }

    private OfflineTts engine() throws IOException {
        if (engine != null) return engine;
        File folder = new File(host.getNoBackupFilesDir(), PACK);
        File marker = new File(folder, ".ready");
        if (!marker.isFile()) {
            copyAssets("voice", folder);
            if (!marker.createNewFile()) throw new IOException("Cannot mark voice pack ready");
        }
        OfflineTtsConfig config = new OfflineTtsConfig();
        OfflineTtsKittenModelConfig kitten = config.getModel().getKitten();
        kitten.setModel(new File(folder, "model.onnx").getPath());
        kitten.setVoices(new File(folder, "voices.bin").getPath());
        kitten.setTokens(new File(folder, "tokens.txt").getPath());
        kitten.setDataDir(new File(folder, "espeak-ng-data").getPath());
        config.getModel().setNumThreads(2);
        engine = new OfflineTts(null, config);
        return engine;
    }

    void speak(String id, String text, float speed, float volume, int speaker) {
        if (closed) return;
        stop();
        final long request = revision;
        worker.execute(() -> {
            File wave = null;
            try {
                if (request != revision) return;
                OfflineTts model = engine();
                if (request != revision) return;
                GeneratedAudio audio = model.generate(text, speaker, speed);
                if (request != revision) return;
                wave = File.createTempFile("wordyarn-", ".wav", host.getCacheDir());
                if (audio.getSamples().length == 0 || !audio.save(wave.getPath())) throw new IOException("Empty audio");
                final File complete = wave;
                host.runOnUiThread(() -> play(request, id, complete, volume));
            } catch (Exception | LinkageError failure) {
                if (wave != null) wave.delete();
                Log.e("WordYarnVoice", "Offline synthesis failed", failure);
                host.runOnUiThread(() -> { if (request == revision) events.send(id, "error"); });
            }
        });
    }

    private void play(long request, String id, File wave, float volume) {
        if (request != revision) { wave.delete(); return; }
        clip = wave;
        try {
            player = new MediaPlayer();
            player.setAudioAttributes(new AudioAttributes.Builder()
                .setUsage(AudioAttributes.USAGE_MEDIA).setContentType(AudioAttributes.CONTENT_TYPE_SPEECH).build());
            player.setDataSource(wave.getPath());
            player.setVolume(volume, volume);
            player.setOnPreparedListener(p -> {
                if (p != player) return;
                ready = true;
                if (!paused) startPlayback();
            });
            player.setOnCompletionListener(p -> { if (p == player) { stop(); events.send(id, "end"); } });
            player.setOnErrorListener((p, what, extra) -> {
                if (p == player) { stop(); events.send(id, "error"); }
                return true;
            });
            playbackId = id;
            player.prepareAsync();
        } catch (IOException | RuntimeException failure) { stop(); events.send(id, "error"); }
    }

    private String playbackId;
    private void startPlayback() {
        player.start();
        if (!started) { started = true; events.send(playbackId, "start"); }
    }

    void pause() {
        paused = true;
        if (ready && started) player.pause();
    }
    void resume() {
        paused = false;
        if (ready) startPlayback();
    }
    void stop() {
        revision++;
        if (player != null) { player.release(); player = null; }
        if (clip != null) { clip.delete(); clip = null; }
        ready = paused = started = false;
    }
    void close() {
        closed = true;
        stop();
        worker.execute(() -> { if (engine != null) { engine.release(); engine = null; } });
        worker.shutdown();
    }
}
