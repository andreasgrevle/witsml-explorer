REM building backend and frontend
docker build -t witsmlexplorer-frontend:latest -f Dockerfile-frontend .
docker build -t witsmlexplorer-api:latest -f Dockerfile-api .
REM complete