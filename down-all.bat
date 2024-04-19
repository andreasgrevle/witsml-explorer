REM stopping MongoDB
docker compose -f docker/MongoDB/docker-compose.yml down
REM stopping backend and frontend
docker compose -f docker/local/docker-compose.yml down
REM complete