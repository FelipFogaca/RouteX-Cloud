const path=require('path'); const multer=require('multer');
module.exports=multer({storage:multer.memoryStorage(),limits:{files:1,fileSize:3*1024*1024},fileFilter:(req,file,cb)=>{const ext=path.extname(file.originalname).toLowerCase();if(ext!=='.xlsx')return cb(new multer.MulterError('LIMIT_UNEXPECTED_FILE',file.fieldname));cb(null,true);}});
