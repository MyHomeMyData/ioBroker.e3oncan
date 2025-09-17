#!/bin/bash

# Check for possibly infected npm modules
# Search for the known malicious bundle.js by hash
#
# See https://www.stepsecurity.io/blog/ctrl-tinycolor-and-40-npm-packages-compromised
#     https://socket.dev/blog/ongoing-supply-chain-attack-targets-crowdstrike-npm-packages
#
# 17.09.2025
#

list_of_suspicious_files="check_ctrl_infect.list"
list_of_installed_modules="check_ctrl_infect.all"
hash_of_malicious_file="46faab8ab153fae6e80e7cca38eab363075bb524edd79e42269217a083628f09"

echo -e "\nStart scan for possibly infected node modules. Listed modules must be checked in detail!"
npm ls --all > $list_of_installed_modules
echo "$(grep -c ^ $list_of_installed_modules) modules are installed."
echo "Checking for $(grep -c ^ $list_of_suspicious_files) suspicious modules ..."

# check for all modules listed in file $list_of_suspicious_files
while read line 
do 
    grep "$line" $list_of_installed_modules
done < $list_of_suspicious_files

echo -e "Done.\n\nSearch for the known malicious bundle.js by hash - malicious files will be listed"
find . -type f -name "*.js" -exec sha256sum {} \; | grep $hash_of_malicious_file

echo -e "\nAll checks were carried out."
