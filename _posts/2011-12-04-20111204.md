---
layout: post
title: 彻底删除git库中的文件
---

代码如下:

```

git filter-branch --index-filter 'git rm -r --cached --ignore-unmatch path/to/your/file' HEAD
git push origin master --force
rm -rf .git/refs/original/
git reflog expire --expire=now --all
git gc --prune=now
git gc --aggressive --prune=now

```


具体可以查看这篇文章 : [从仓库中删除敏感数据](https://docs.github.com/cn/free-pro-team@latest/github/authenticating-to-github/removing-sensitive-data-from-a-repository)

另外注意在多人协同工作时,防止其他人又将文件提交上来(如某些文件之前没有加入到.gitignore文件中,然后这个文件更改了),需要每个人执行上面除push外的其它代码,或者重新clone.