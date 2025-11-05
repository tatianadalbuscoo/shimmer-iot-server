# Shimmer IoT Server

A lightweight Node.js/Express API to ingest measurements from **Shimmer** devices, store them in **MongoDB**, and expose endpoints to query recent data and device lists. Includes a **Docker Compose** stack for MongoDB and **mongo-express**.

---

## Features

- REST API for ingesting **IMU** and **EXG** signals  
- Endpoints to query latest measurements and list known devices  
- Health endpoint for liveness/readiness checks  
- Local DB stack via Docker Compose  
- Dev/test scripts via npm

---

## Tech Stack

- **Runtime:** Node.js (18+)  
- **Web:** Express  
- **DB:** MongoDB  
- **Admin UI:** mongo-express  
- **Containers:** Docker Compose  
- **Tests:** npm test

---

## Getting Started

Create a `.env` (you can copy from `.env.example`), start the DB stack, install dependencies, and run the server.

Typical `.env` keys:

    PORT=3000
    MONGODB_URI=mongodb://localhost:27017/shimmer
    NODE_ENV=development

Start the database stack (MongoDB + mongo-express):

    docker compose up -d

Install deps & run the API:

    npm install
    npm start

Smoke test:

    curl http://localhost:3000/health

Mongo Express UI:

    http://localhost:8081

---

## API

### Health

**GET** `/health` — Quick liveness/readiness probe.

    curl http://localhost:3000/health

### Ingest measurements

**POST** `/api/measurements`  
`Content-Type: application/json`

PowerShell — IMU only

    $body = @{
      shimmerName = "E0D9"
      isEXG       = $false
      userName    = "Antonio Rossi"
      imu = @{
        lowNoiseAcc  = @{ x=0.01; y=0.02; z=0.98 }
        wideRangeAcc = @{ x=0.1;  y=0.1;  z=1.0 }
        gyroscope    = @{ x=0.0;  y=0.0;  z=0.0 }
        magnetometer = @{ x=30;   y=-5;   z=45 }
        pressure     = 101325
        temperature  = 24.1
        battery      = 96
        externalADC  = @{ adc1=0.12; adc2=0.15; adc3=0.10 }
      }
    }
    Invoke-RestMethod -Method POST -Uri http://localhost:3000/api/measurements `
      -ContentType 'application/json' -Body ($body | ConvertTo-Json -Depth 6)

PowerShell — EXG + IMU

    $body = @{
      shimmerName = "E123"
      isEXG       = $true
      userName    = "Antonio Rossi"
      exg = @{
        exg1 = 12.3
        exg2 = 8.1
      }
      imu = @{
        lowNoiseAcc  = @{ x=0.01; y=0.02; z=0.98 }
        wideRangeAcc = @{ x=0.1;  y=0.1;  z=1.0 }
        gyroscope    = @{ x=0.0;  y=0.0;  z=0.0 }
        magnetometer = @{ x=30;   y=-5;   z=45 }
        pressure     = 101325
        temperature  = 24.1
        battery      = 96
        externalADC  = @{ adc1=0.12; adc2=0.15; adc3=0.10 }
      }
    }
    Invoke-RestMethod -Method POST -Uri http://localhost:3000/api/measurements `
      -ContentType 'application/json' -Body ($body | ConvertTo-Json -Depth 6)

Example JSON (curl)

    curl -X POST http://localhost:3000/api/measurements \
      -H "Content-Type: application/json" \
      -d '{
        "shimmerName":"E0D9",
        "isEXG":false,
        "userName":"Antonio Rossi",
        "imu":{
          "lowNoiseAcc":{"x":0.01,"y":0.02,"z":0.98},
          "wideRangeAcc":{"x":0.1,"y":0.1,"z":1.0},
          "gyroscope":{"x":0.0,"y":0.0,"z":0.0},
          "magnetometer":{"x":30,"y":-5,"z":45},
          "pressure":101325,
          "temperature":24.1,
          "battery":96,
          "externalADC":{"adc1":0.12,"adc2":0.15,"adc3":0.10}
        }
      }'

### Query recent measurements

**GET** `/api/measurements?limit=5`

    curl.exe "http://localhost:3000/api/measurements?limit=5"

### Latest measurement by device

**GET** `/api/measurements/latest?shimmerName=E123`

    curl.exe "http://localhost:3000/api/measurements/latest?shimmerName=E123"

### List devices

**GET** `/api/devices`

    curl.exe "http://localhost:3000/api/devices"

---

## Development & Tests

Bring up a local DB stack for dev/tests:

    npm run db:up

Run tests:

    npm test

---

## Maintenance

Stop containers and **delete the data volume**:

    docker compose down -v

---

## Common Commands (quick recap)

    docker compose up -d
    npm start
    curl http://localhost:3000/health
    curl.exe http://localhost:3000/api/measurements?limit=5
    curl.exe "http://localhost:3000/api/measurements/latest?shimmerName=E123"
    curl.exe http://localhost:3000/api/devices
    # Admin UI:
    # http://localhost:8081
    # Stop & wipe DB data:
    docker compose down -v
    # Tests:
    npm run db:up
    npm test

