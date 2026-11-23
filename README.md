# Cat Hand Play — 수정판

작은 3D 고양이가 화면 안을 돌아다니며 쉬는 웹앱입니다. 흰 배경, 은은한 좌우 반전 카메라와 손 관절 표시를 유지하며 평상시 글자·숫자를 표시하지 않습니다.

## 실행

압축을 푼 `cat-hand-play` 폴더에서 실행하세요.

```sh
python3 -m http.server 8000
```

브라우저에서 http://localhost:8000 을 열고 발바닥을 눌러 카메라를 허용하세요. 카메라를 켜기 전에도 자율 행동합니다. 파일을 더블클릭하는 file:// 방식은 지원하지 않습니다. 공개 서버에서는 HTTPS가 필요합니다.

## 손가락 접촉

한 손의 검지·중지·약지·새끼손가락 끝을 독립적으로 검사합니다. 엄지는 제외합니다. 손가락을 꼭 펼칠 필요 없이, 화면에서 고양이 표면과 겹치는 손끝을 약 0.14초 유지하세요.

- 1개: 머리를 비비며 ❤️
- 2개: 손끝 반대 방향으로 달아나며 ❗️
- 3개: 뛰며 💢
- 4개: 엎드려 잠들며 💤

같은 접촉을 유지하면 반응을 계속 재실행하지 않습니다. 손을 약 0.2초 떼거나 접촉 개수를 바꾸면 다시 반응합니다. 각 반응이 끝나면 자율 행동으로 돌아갑니다. 접촉은 카메라 영상과 3D 표면의 화면상 겹침 기준이며 실제 공간 깊이를 측정하는 방식은 아닙니다.

## 변경 내용

- 고해상도 화면에서 캔버스의 CSS 크기와 내부 픽셀 크기를 일치시켜 우하단 치우침·과대 표시를 수정했습니다.
- 고양이를 작게 정규화하고 화면 전역의 무작위 목적지로 이동시킵니다. 화면 크기 변경과 애니메이션 중에도 모델이 화면 밖으로 나가지 않도록 제한합니다.
- 단순 사각형 판정 대신 애니메이션 중인 고양이 표면과 손끝의 겹침을 검사합니다. 9px 정도의 손끝 여유를 둡니다.
- 기존 GLB의 Walk, Idle, Idle_Eating 등과 새 휴식 자세를 0.55초에 걸쳐 블렌드합니다.
- GLB 원본 클립: Death, Headbutt, Idle, Idle_Eating, Jump_Loop, Jump_Start, Run, Walk.
- 수면/엎드림 전용 원본 클립은 없습니다. Idle 기반으로 다리·머리·꼬리 뼈대와 호흡을 조절하는 RestPose, LiePose, SleepPose를 코드에서 생성합니다. 모델 전체를 납작하게 압축하지 않습니다.
- 감정 이모지가 고양이를 따라다니며, 특별 반응은 접촉으로만 시작합니다.
- 카메라/인식 초기화 실패 시 자율 행동을 유지하고 카메라 자원을 정리해 재시도할 수 있게 했습니다.

## 의존성 및 배포 파일

Three.js 0.170.0, MediaPipe Tasks Vision 0.10.21은 jsDelivr에서, 손 인식 모델은 Google에서 로드하므로 인터넷 연결이 필요합니다. cat.glb는 포함되어 있습니다. index.html, main.js, interaction.mjs, cat.glb를 같은 폴더에 올리면 됩니다. ZIP에는 공개 배포 주소가 포함되지 않습니다.

## 검증

```sh
node --test tests/interaction.test.mjs
```

수행한 검증과 제한은 TEST-RESULTS.md를 참고하세요.

API 참고:
- https://developers.google.com/edge/mediapipe/solutions/vision/hand_landmarker
- https://github.com/mrdoob/three.js/blob/dev/docs/pages/SkinnedMesh.html.md
