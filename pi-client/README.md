# pi-client

라즈베리파이에서 환경 센서 값을 읽어 **AWS IoT Core**로 publish 하는 클라이언트입니다.
라즈베리파이에 서버를 띄우는 구조가 아니라, `systemd`로 Python publisher 데몬 1개만 계속 실행합니다.

상위 프로젝트 개요: [../README.md](../README.md) · 서버/AWS Lambda: [../asthma-server/README.md](../asthma-server/README.md)

---

## 현재 작성 상태

현재 사용 가능 상태에 맞춰 DHT11만 실물 센서로 읽고, 사용할 수 없는 ZPH01/SGP30은 랜덤 대체값으로 publish합니다.

```text
pi-client/
├── .env.example
├── requirements.txt
├── src/
│   ├── config.py          # AWS IoT endpoint/cert/env/sensor 설정
│   ├── main.py            # systemd/CLI 진입점
│   ├── publisher.py       # AWS IoT MQTT mTLS 연결 + publish 루프
│   └── sensors/
│       ├── dht11.py       # DHT11: 온도/습도, GPIO4
│       ├── environment.py       # Random ZPH01 + DHT11 + Random SGP30 값 병합
│       ├── mock.py              # 노트북/demo용 전체 mock 센서
│       ├── random_substitutes.py # ZPH01/SGP30 대체 랜덤 센서
│       ├── sgp30.py             # SGP30 실제 driver 보관용
│       └── zph01.py             # ZPH01 실제 driver 보관용
├── systemd/
│   └── cloud-iot-pi.service
└── tests/
    ├── test_client_contract.py
    └── test_hardware_sensors.py
```

실제 라즈베리파이에서는 `.env`의 `MOCK_SENSOR=false`로 실행합니다. 이때 DHT11은 실제 GPIO에서 읽고, ZPH01/SGP30 값은 적정 범위에서 랜덤 생성합니다. 노트북에서만 테스트할 때는 `MOCK_SENSOR=true`로 바꾸면 전체 값이 mock으로 생성됩니다.

---

## 현재 센서 사용 방식

### 실제로 읽는 센서: DHT11

| DHT11 핀 | Raspberry Pi 4 연결 | 설명 |
|---|---|---|
| DATA | GPIO4 / 물리 Pin 7 | 데이터 신호 |
| VCC | 3.3V | 전원 공급 |
| GND | GND | 접지 |

DATA에는 10kΩ 풀업 저항을 3.3V에 연결합니다.

```text
3.3V ── 10kΩ ── DATA ── GPIO4
```

- 코드: `src/sensors/dht11.py`
- publish 필드: `temperature`, `humidity`

### 랜덤 대체값으로 처리하는 센서

현재 ZPH01과 SGP30은 사용할 수 없는 상황이므로 실제 하드웨어 초기화/읽기를 하지 않습니다. 대신 `src/sensors/random_substitutes.py`가 아래 범위에서 값을 생성합니다.

| 대체 대상 | publish 필드 | 랜덤 범위 |
|---|---|---|
| ZPH01 미세먼지 센서 | `pm25` | 5 ~ 65 µg/m³ |
| ZPH01 미세먼지 센서 | `pm10` | `pm25 + 4` ~ `pm25 + 45` µg/m³ |
| SGP30 공기질 센서 | `co2` | 450 ~ 1600 ppm |
| SGP30 공기질 센서 | `voc` | 0.05 ~ 0.85 |

보관용으로 `zph01.py`, `sgp30.py` 실제 driver 파일은 남겨두었지만, 현재 실행 경로에서는 사용하지 않습니다.

---

## 실행 구조

1. 라즈베리파이 부팅
2. `systemd`가 `cloud-iot-pi.service` 실행
3. Python client가 X.509 인증서로 AWS IoT Core에 MQTT mTLS 연결
4. DHT11 실제값 + ZPH01/SGP30 랜덤 대체값을 하나의 payload로 병합
5. topic `health/sensor/{DEVICE_ID}/environment`로 publish
6. AWS IoT Rule → Lambda → DynamoDB 흐름으로 저장

토픽 계약:

```text
health/sensor/rpi_001/environment
```

payload 예시:

```json
{
  "device_id": "rpi_001",
  "timestamp": "2026-04-22T05:18:06.176Z",
  "pm25": 47.47,
  "co2": 512,
  "voc": 0.023,
  "temperature": 22.06,
  "humidity": 46.28
}
```

현재 `pm10`은 ZPH01 대체 랜덤값으로 함께 보냅니다. 서버/Lambda는 필드 누락도 허용하지만, 시연 payload가 더 풍부하게 보이도록 포함합니다.

---

## AWS 쪽 Thing/인증서 준비

개발 PC에서 AWS CLI 로그인 상태로 실행합니다. 이미 만든 AWS 리전은 `ap-northeast-2` 기준입니다.

```bash
cd pi-client

REGION=ap-northeast-2
THING_NAME=rpi_001
POLICY_NAME=cloud-iot-team4-rpi-publisher
ACCOUNT_ID=$(aws sts get-caller-identity --query Account --output text)
IOT_ENDPOINT=$(aws iot describe-endpoint \
  --endpoint-type iot:Data-ATS \
  --region "$REGION" \
  --query endpointAddress \
  --output text)

mkdir -p certs
curl -o certs/AmazonRootCA1.pem https://www.amazontrust.com/repository/AmazonRootCA1.pem
aws iot create-thing --thing-name "$THING_NAME" --region "$REGION" || true

CERT_ARN=$(aws iot create-keys-and-certificate \
  --set-as-active \
  --certificate-pem-outfile "certs/${THING_NAME}.pem.crt" \
  --public-key-outfile "certs/${THING_NAME}.public.key" \
  --private-key-outfile "certs/${THING_NAME}.private.pem.key" \
  --region "$REGION" \
  --query certificateArn \
  --output text)

cat > /tmp/cloud-iot-rpi-policy.json <<EOF
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": ["iot:Connect"],
      "Resource": ["arn:aws:iot:${REGION}:${ACCOUNT_ID}:client/${THING_NAME}"]
    },
    {
      "Effect": "Allow",
      "Action": ["iot:Publish"],
      "Resource": ["arn:aws:iot:${REGION}:${ACCOUNT_ID}:topic/health/sensor/${THING_NAME}/environment"]
    }
  ]
}
EOF

aws iot create-policy \
  --policy-name "$POLICY_NAME" \
  --policy-document file:///tmp/cloud-iot-rpi-policy.json \
  --region "$REGION" || true

aws iot attach-policy \
  --policy-name "$POLICY_NAME" \
  --target "$CERT_ARN" \
  --region "$REGION"

aws iot attach-thing-principal \
  --thing-name "$THING_NAME" \
  --principal "$CERT_ARN" \
  --region "$REGION"

cp .env.example .env
sed -i.bak "s|^AWS_IOT_ENDPOINT=.*|AWS_IOT_ENDPOINT=${IOT_ENDPOINT}|" .env
```

`certs/`와 `.env`는 기기별 비밀 정보이므로 git에 올리지 않습니다.

---

## 라즈베리파이 설치

라즈베리파이에 repo 또는 `pi-client/` 폴더를 복사한 뒤 실행합니다.

```bash
sudo apt update
sudo apt install -y python3-venv python3-pip libgpiod2
```

GPIO 권한 추가 후 재부팅:

```bash
sudo usermod -aG gpio $USER
sudo reboot
```

현재 ZPH01/SGP30은 랜덤 대체값을 쓰므로 UART/I2C 활성화는 필수가 아닙니다. DHT11만 GPIO4로 읽습니다.

Python 환경:

```bash
cd ~/cloud-iot-team-4/pi-client
python3 -m venv .venv
. .venv/bin/activate
pip install --upgrade pip
pip install -r requirements.txt
```

`.env`와 `certs/`가 `pi-client/` 안에 있어야 합니다. 현재 구성에서 `.env` 핵심값은 아래입니다.

```dotenv
MOCK_SENSOR=false
DHT11_PIN=D4
DHT11_USE_PULSEIO=false
```

수동 실행:

```bash
cd ~/cloud-iot-team-4/pi-client
. .venv/bin/activate
python -m src.main
```

---

## 부팅 시 자동 실행(systemd)

서비스 파일의 경로는 기본적으로 `/home/pi/cloud-iot-team-4/pi-client`를 가정합니다. 다른 위치에 두면 `systemd/cloud-iot-pi.service`의 `WorkingDirectory`, `ExecStart`를 바꿉니다.

```bash
cd ~/cloud-iot-team-4/pi-client
sudo cp .env /etc/cloud-iot-pi.env
sudo cp systemd/cloud-iot-pi.service /etc/systemd/system/cloud-iot-pi.service
sudo systemctl daemon-reload
sudo systemctl enable --now cloud-iot-pi.service
sudo journalctl -u cloud-iot-pi.service -f
```

중지/재시작:

```bash
sudo systemctl stop cloud-iot-pi.service
sudo systemctl restart cloud-iot-pi.service
```

---

## 코드 확장 위치

센서 드라이버는 구조상 `pi-client/src/sensors/` 아래에 둡니다.

현재 매핑:

```text
src/sensors/
├── random_substitutes.py # ZPH01/SGP30 랜덤 대체값
├── dht11.py              # GPIO4 temperature/humidity
├── environment.py        # 여러 센서 값 병합
├── zph01.py              # 실제 ZPH01 driver 보관용
├── sgp30.py              # 실제 SGP30 driver 보관용
└── mock.py               # mock/demo
```

나중에 ZPH01/SGP30을 다시 쓸 수 있게 되면 `environment.py`에서 `RandomZPH01DustSensor`, `RandomSGP30AirQualitySensor` 대신 실제 driver로 바꾸면 됩니다. 새 센서를 추가하더라도 `read()`가 아래처럼 일부 field dict를 반환하면 병합할 수 있습니다.

```python
{"pm25": 12.3, "co2": 650, "voc": 0.2, "temperature": 23.1, "humidity": 45.0}
```

---

## 로컬 검증

개발 PC 또는 라즈베리파이에서:

```bash
python3 -m unittest discover -s pi-client/tests -v
python3 -m py_compile $(find pi-client/src -name '*.py')
```

AWS까지 end-to-end 확인:

```bash
# Pi client 실행 후, 개발 PC에서 DynamoDB 최신 ENV item 확인
aws dynamodb query \
  --table-name AsthmaGuideData \
  --key-condition-expression 'pk = :pk' \
  --expression-attribute-values '{":pk":{"S":"DEVICE#rpi_001"}}' \
  --scan-index-forward false \
  --limit 1 \
  --region ap-northeast-2
```

---

## 참고 자료

- Adafruit CircuitPython DHT: DHT11 uses a single data pin such as `board.D4`
- ZPH01/SGP30은 현재 실물 미사용이며 `random_substitutes.py`에서 랜덤 대체값 생성
