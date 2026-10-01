const path=require('path'); const multer=require('multer');
module.exports=multer({storage:multer.memoryStorage(),limits:{files:100,fileSize:1024*1024},fileFilter:(req,file,cb)=>{if(path.extname(file.originalname).toLowerCase()!=='.xml')return cb(new multer.MulterError('LIMIT_UNEXPECTED_FILE',file.fieldname));cb(null,true);}});
