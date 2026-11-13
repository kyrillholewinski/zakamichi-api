pm2 start index.js --name "zakamichi-api" -i max -o ./logs/out.log -e ./logs/error.log --log-date-format "YYYY-MM-DD HH:mm:ss Z" --kill-timeout 300 --max-memory-restart 500M 

pm2 start index.js --name "zakamichi-api" ./logs/out.log -e ./logs/error.log --log-date-format "YYYY-MM-DD HH:mm:ss Z" 