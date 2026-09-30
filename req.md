

## Tech stack
Chrome DevTools Protocol โดยมี Node.js เป็นตัว Driver, FastAPI เป็น Decision Server และใช้ Laya model รันผ่าน PyTorch + CUDA บน GPU ส่วน SSE ใช้ส่งผลการตัดสินไปแสดงบน Live HUD แบบเรียลไทม์
เราเปิด Chrome ด้วย --remote-debugging-port แล้วให้ Node.js เชื่อมผ่าน CDP จากนั้นใช้ Runtime.evaluate อ่าน Runner.getInstance() จาก object ภายในเกมโดยตรง 

## Dino web workflow
* URL=`chrome://dino`
* ใช้ Chrome DevTools Protocol(CDP) ในการควบคุมเกม Dino บนเว็บด้วย NodeJS
* อ่านสถานะของเกมโดยตรงจาก object ภายในเกมผ่าน Runtime.evaluate จาก object ต่าง ๆ ภายในเกมส์
* ในการตัดสินใจ ให้ส่งข้อมูลสถานะของเกมไปยัง REST API ที่พัฒนาด้วย NodeJS+Express ซึ่งทำหน้าที่เป็น Decision Server ด้วยการเรียกใช้งานผ่าน Jev API(https://docs.typesafe.ai/sdk/javascript) และรับผลการตัดสินใจกลับมาเพื่อควบคุมเกม และส่งกลับไปยัง Node.js