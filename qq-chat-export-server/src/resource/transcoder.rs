use std::path::{Path, PathBuf};

use async_trait::async_trait;

use super::SilkTranscoder;

const OUTPUT_SAMPLE_RATE: u32 = 24_000;

/// 本地 SILK → WAV 转码器。
pub struct NativeSilkTranscoder;

#[async_trait]
impl SilkTranscoder for NativeSilkTranscoder {
    fn target_extension(&self) -> &'static str {
        "wav"
    }

    fn target_mime_type(&self) -> &'static str {
        "audio/wav"
    }

    async fn transcode(&self, silk_path: &Path, output_path: &Path) -> bool {
        let silk_path = PathBuf::from(silk_path);
        let decoded = tokio::task::spawn_blocking(move || {
            silk_decoder_rs::silk_to_wav(OUTPUT_SAMPLE_RATE, &silk_path.to_string_lossy())
        })
        .await;

        let wav = match decoded {
            Ok(Ok(wav)) if wav.len() > 44 => wav,
            Ok(Ok(_)) => {
                tracing::warn!("SILK 转码未生成有效 WAV 数据");
                return false;
            }
            Ok(Err(error)) => {
                tracing::warn!("SILK 转码失败: {error}");
                return false;
            }
            Err(error) => {
                tracing::warn!("SILK 转码任务失败: {error}");
                return false;
            }
        };

        if let Err(error) = tokio::fs::write(output_path, wav).await {
            tracing::warn!("写入 SILK 转码结果失败: {error}");
            return false;
        }
        true
    }
}

#[cfg(test)]
mod tests {
    use base64::Engine as _;

    use super::*;

    const SILK_FIXTURE: &str = "AiMhU0lMS19WMywAx1+xeCLEFacZbGwaOeNFDexZFSa2usNgNPBEE9m4CLbKPe6MSXwkKOPSz/8wAL90PwGOF2KCfmWe7epjyNQxKzqeK1nzEBBh/ekRxGdCj9OSMAS37eOHM1Uff+kkf3EAvuyP7heg4aKRo9iVF9ZugHwleDNvWDQy5IESWDx6c8/XBOUELpzcFtp6Td0W60UIAEmVoiksSwoEstWz8GizLFwcwFZ0G1/DqmoEOMxdi4fMMGJ8t+usQUshz4NzpSuigt3X4Zdp49tqXB5pkEHNzHdcAL7sczWa1PiKj00CZr6jbvQyAnn+oyW2xdS9FRbqUQ8WJ7j8lKAZYNy2myKti1S8+QQt13sBEJ9/GJ+rSBtJ6fZDZmEAJs58nZVifYHDGCjSYYVIVz0n+vMIfMF/awC+7I/wC5DFopGi7Xp4CtuYj06OTFyomBR6Z/LStxQCLfNYllFBbKjm3TxFXzvvRCKNq6eXrtR696ZdoF1VzqUeLWyUBMFOxn1sQSkHDxNDEm5+6M72lrjdVoiM0RmRA31CQJMrxXpL4ewdGHEAvuyP8BrDPf/josGdYNLeGnSDYqQ7q1ggLXhZAa1B9BW53Kly8likmeTog7vyFT5aJ/qWjbwAgKfe8e8Jp8UEEnMQYVfQvmH26qJcfL1B/V8LSsOha7UOXY96HrbHcjZRssDsZaRwnJbRf9aCY69l4r9kAL7sj/ALkMWikaKV9H2bU8e+IgvfoNbxYdkB1kJqPK1E0kJ+9XFxXvYbRRPGw6ytMjtcL8MPnq/AUcNYKKy0L9vStqDo2o41m686VXEYReL6JktZx87XgrQEJUz4zCO1w6lshJ9GAL+EpAreEy42ST0ZKM39BL1Q27laRzARkOQDvGkMzHfFFVtN4qaNHH+aB2nQq15f3Imj5I9d405wT6hBcnq+/oL1fDy+iv9dAL+EpArMUDOy8DCDx1Fk4CKiMDoAV6Tk9O2e5MRlL0aaKZTX6M15xZWGo+tCTEi55QK1rS6i6pGFmgAD81TJnaIq2QG6hu4qgxFi9O64zdcy8uDkoSpowk1geXyB0l0Av4SkCsxQM7LwMHrxMa6VPbSYbk5HvQ7U3ESOzM+Ft4DtDOKrhQ566aGb++5y53lmNTnzN14hyM2kb9g5PRTzpWcfDwNjnFN858ujYAHZsxi/HRNjkFzlamDafGk/";

    #[tokio::test]
    async fn transcodes_silk_to_browser_playable_wav() {
        let root = std::env::temp_dir().join(format!("qce-silk-{}", uuid::Uuid::new_v4()));
        tokio::fs::create_dir_all(&root)
            .await
            .expect("create test directory");
        let silk_path = root.join("voice.silk");
        let wav_path = root.join("voice.wav");
        let silk = base64::engine::general_purpose::STANDARD
            .decode(SILK_FIXTURE)
            .expect("decode silk fixture");
        tokio::fs::write(&silk_path, silk)
            .await
            .expect("write silk fixture");

        let transcoder = NativeSilkTranscoder;
        assert!(transcoder.transcode(&silk_path, &wav_path).await);

        let wav = tokio::fs::read(&wav_path).await.expect("read wav output");
        assert!(wav.len() > 44);
        assert_eq!(&wav[0..4], b"RIFF");
        assert_eq!(&wav[8..12], b"WAVE");

        tokio::fs::remove_dir_all(root)
            .await
            .expect("remove test directory");
    }
}
