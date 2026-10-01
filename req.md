## Dino web workflow with Jev API
* URL=`chrome://dino`
* ใช้ Chrome DevTools Protocol(CDP) ในการควบคุมเกม Dino บนเว็บด้วย NodeJS
* อ่านสถานะของเกมโดยตรงจาก object ภายในเกมผ่าน Runtime.evaluate จาก object ต่าง ๆ ภายในเกมส์
* ในการตัดสินใจ ให้ส่งข้อมูลสถานะของเกมไปยัง REST API ที่พัฒนาด้วย NodeJS+Express ซึ่งทำหน้าที่เป็น Decision Server ด้วยการเรียกใช้งานผ่าน Jev API(https://docs.typesafe.ai/sdk/javascript) และรับผลการตัดสินใจกลับมาเพื่อควบคุมเกม และส่งกลับไปยัง Node.js